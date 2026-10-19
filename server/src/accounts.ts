import { createHash, randomBytes, randomUUID, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { getDb } from "./db/db.js";
import { getConfig } from "./config.js";

const params = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const derive=(password:string,salt:string)=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,params,(e,key)=>e?reject(e):resolve(key)));
const lifetime = 30 * 86400_000;
const cookie = "vf_account";
let activeHashes=0;
async function boundedHash<T>(work:()=>Promise<T>):Promise<T>{
  if(activeHashes>=2)throw Object.assign(new Error("Login service is busy. Please retry shortly."),{status:503});
  activeHashes++;try{return await work();}finally{activeHashes--;}
}
type User = { id: string; email: string; live_approved: number; password_hash: string };
const credentials = z.object({ email: z.string().trim().email().max(254).transform(s=>s.toLowerCase()), password: z.string().min(1).max(128) }).strict();
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const publicUser = (u: User) => ({ id: u.id, email: u.email, liveApproved: Boolean(u.live_approved), isAdmin: u.email===getConfig().ADMIN_USERNAME.trim().toLowerCase() });
async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await boundedHash(()=>derive(password, salt));
  return `${salt}:${key.toString("hex")}`;
}
async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, encoded] = stored.split(":");
  const key = await boundedHash(()=>derive(password, salt!));
  const expected = Buffer.from(encoded!, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}
let dummyHash = "";
export function bootstrapOwner(): void {
  const cfg = getConfig(), db = getDb(), email = cfg.ADMIN_USERNAME.trim().toLowerCase();
  // Existing deployment secrets bootstrap exactly once; never publish/default a real password.
  if (email.includes("@") && cfg.ADMIN_PASSWORD && !db.prepare("SELECT 1 FROM users WHERE email=?").get(email)) {
    const salt = randomBytes(16).toString("hex"), at = new Date().toISOString();
    const hash = `${salt}:${scryptSync(cfg.ADMIN_PASSWORD, salt, 64, params).toString("hex")}`;
    db.prepare("INSERT INTO users VALUES(?,?,?,1,?,?)").run(`account_${randomUUID()}`,email,hash,at,at);
  }
  if (!dummyHash) { const salt = randomBytes(16).toString("hex"); dummyHash = `${salt}:${scryptSync(randomBytes(32),salt,64,params).toString("hex")}`; }
}
export function accountContext(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.cookie?.split(";").map(s=>s.trim()).find(s=>s.startsWith(cookie+"="))?.slice(cookie.length+1);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const user = getDb().prepare("SELECT u.*,s.expires_at FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").get(hashToken(token),Date.now()) as (User & {expires_at:number}) | undefined;
    if (user) { res.locals.account=user; res.locals.accountTokenHash=hashToken(token); }
  }
  next();
}
function setCookie(req: Request, res: Response, token: string, maxAge: number): void {
  res.cookie(cookie,token,{ httpOnly:true,secure:req.secure,sameSite:"lax",path:"/",maxAge });
}
export function sameOrigin(req: Request,res: Response,next: NextFunction): void {
  if ((req.get("origin") && req.get("origin") !== `${req.protocol}://${req.get("host")}`) || req.get("sec-fetch-site")==="cross-site") {
    res.status(403).json({error:"Account changes must originate from this site."});return;
  }
  next();
}
export async function register(req: Request,res: Response,next: NextFunction): Promise<void> {
  try {
    const parsed=credentials.safeParse(req.body);
    if (!parsed.success || parsed.data.password.length<12) {res.status(400).json({error:"Enter a valid email and a password of 12–128 characters."});return;}
    const {email,password}=parsed.data, hash=await passwordHash(password), at=new Date().toISOString();
    if(getDb().prepare("SELECT 1 FROM users WHERE email=?").get(email)){res.status(409).json({error:"This email cannot be registered. Try logging in or contact the administrator."});return;}
    const created=getDb().prepare("INSERT OR IGNORE INTO users VALUES(?,?,?,0,?,?)").run(`account_${randomUUID()}`,email,hash,at,at);
    if(!created.changes){res.status(409).json({error:"This email cannot be registered. Try logging in or contact the administrator."});return;}
    res.status(201).json({ok:true,message:"Account created. Log in to see your approval status. Live requires admin approval."});
  } catch(e){next(e);}
}
export async function login(req: Request,res: Response,next: NextFunction): Promise<void> {
  try {
    const parsed=credentials.safeParse(req.body);
    if(!parsed.success){res.status(400).json({error:"Enter a valid email and password."});return;}
    const user=getDb().prepare("SELECT * FROM users WHERE email=?").get(parsed.data.email) as User|undefined;
    if(!await passwordMatches(parsed.data.password,user?.password_hash??dummyHash)||!user){res.status(401).json({error:"Invalid email or password."});return;}
    const token=randomBytes(32).toString("hex"), db=getDb();
    db.prepare("DELETE FROM user_sessions WHERE expires_at<=?").run(Date.now());
    db.prepare("INSERT INTO user_sessions VALUES(?,?,?,?)").run(hashToken(token),user.id,Date.now()+lifetime,new Date().toISOString());
    setCookie(req,res,token,lifetime);res.json({user:publicUser(user)});
  }catch(e){next(e);}
}
export function me(_req: Request,res: Response): void { res.json({user:res.locals.account?publicUser(res.locals.account):null}); }
export function renew(req: Request,res: Response): void {
  if(!res.locals.account){res.status(401).json({error:"Log in again to renew your session."});return;}
  getDb().prepare("UPDATE user_sessions SET expires_at=? WHERE token_hash=?").run(Date.now()+lifetime,res.locals.accountTokenHash);
  const token=req.headers.cookie!.split(";").map(s=>s.trim()).find(s=>s.startsWith(cookie+"="))!.slice(cookie.length+1);
  setCookie(req,res,token,lifetime);me(req,res);
}
export function logout(req: Request,res: Response): void {
  if(res.locals.accountTokenHash)getDb().prepare("DELETE FROM user_sessions WHERE token_hash=?").run(res.locals.accountTokenHash);
  setCookie(req,res,"",0);res.json({ok:true});
}
export function requireLiveAccess(req: Request,res: Response,next: NextFunction): void {
  const mode=req.method==="POST"?req.body?.mode:req.query.mode;
  // An omitted mode can resolve to Live in production; protect it as well.
  if(mode!=="demo" && (mode==="live" || getConfig().DATA_MODE!=="synthetic")) {
    if(!res.locals.account){res.status(401).json({error:"Log in to request Live access.",code:"LOGIN_REQUIRED"});return;}
    if(!res.locals.account.live_approved){res.status(403).json({error:"Live access is pending or revoked. Contact the administrator.",code:"LIVE_APPROVAL_REQUIRED"});return;}
  }
  next();
}
export function listUsers(req: Request,res: Response): void {
  const page=Number(req.query.page??1), q=String(req.query.q??"").trim().slice(0,254);
  if(!Number.isSafeInteger(page)||page<1||page>1000000){res.status(400).json({error:"Invalid page"});return;}
  const db=getDb(), pattern=`%${q.replace(/[\\%_]/g,"\\$&")}%`;
  const users=db.prepare("SELECT id,email,live_approved AS liveApproved,created_at AS createdAt,updated_at AS updatedAt FROM users WHERE email LIKE ? ESCAPE '\\' ORDER BY created_at DESC,id LIMIT 25 OFFSET ?").all(pattern,(page-1)*25);
  const total=(db.prepare("SELECT COUNT(*) n FROM users WHERE email LIKE ? ESCAPE '\\'").get(pattern) as {n:number}).n;
  res.json({users,total,page,pageSize:25});
}
export async function updateUser(req: Request,res: Response,next: NextFunction): Promise<void> {
  try {
    const parsed=z.discriminatedUnion("action",[z.object({action:z.enum(["approve","revoke"])}).strict(),z.object({action:z.literal("resetPassword"),password:z.string().min(12).max(128)}).strict()]).safeParse(req.body);
    if(!parsed.success){res.status(400).json({error:"Choose approve/revoke, or resetPassword with a 12–128 character password."});return;}
    const id=String(req.params.id), db=getDb(), user=db.prepare("SELECT * FROM users WHERE id=?").get(id) as User|undefined;
    if(!user){res.status(404).json({error:"User not found"});return;}
    const body=parsed.data, hash=body.action==="resetPassword"?await passwordHash(body.password):null, at=new Date().toISOString();
    db.transaction(()=>{
      if(hash)db.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=?").run(hash,at,id);
      else db.prepare("UPDATE users SET live_approved=?,updated_at=? WHERE id=?").run(body.action==="approve"?1:0,at,id);
      if(body.action!=="approve")db.prepare("DELETE FROM user_sessions WHERE user_id=?").run(id);
      db.prepare("INSERT INTO user_access_audit(actor,user_id,action,created_at) VALUES(?,?,?,?)").run(getConfig().ADMIN_USERNAME,id,body.action,at);
    })();
    res.json({ok:true});
  }catch(e){next(e);}
}
