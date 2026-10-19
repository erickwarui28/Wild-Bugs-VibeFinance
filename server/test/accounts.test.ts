import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import request from "supertest";
import {createApp} from "../src/app.js";
import {getDb,closeDb} from "../src/db/db.js";
import {resetConfigForTests} from "../src/config.js";
import {issueIdentity} from "../src/identity.js";
import {runWithVisitor,reserveOpenAiCall} from "../src/usage.js";

const email="owner@example.test",password="owner-local-test-only";
beforeEach(()=>{vi.stubEnv("ADMIN_USERNAME",email);vi.stubEnv("ADMIN_PASSWORD",password);resetConfigForTests();getDb().exec("DELETE FROM user_sessions;DELETE FROM users;DELETE FROM user_access_audit;");});
afterEach(()=>{vi.unstubAllEnvs();resetConfigForTests();});
describe("accounts and approved Live access",()=>{
  it("bootstraps owner without a plaintext database password and keeps Demo public",async()=>{
    const app=createApp(),user=getDb().prepare("SELECT * FROM users WHERE email=?").get(email) as {password_hash:string;live_approved:number};
    expect(user.password_hash).not.toContain(password);expect(user.live_approved).toBe(1);
    const identity=issueIdentity();
    await request(app).get("/api/tickers?mode=demo").expect(200);
    for(const path of ["/api/tickers?mode=live","/api/market/INFY?mode=live","/api/search?mode=live"])
      await request(app).get(path).expect(401);
    for(const path of ["/api/analyze","/api/compare"])
      await request(app).post(path).set("x-vf-visitor",identity.token).send({ticker:"INFY",mode:"live",profileId:"moderate"}).expect(401);
    vi.stubEnv("DATA_MODE","live");resetConfigForTests();
    await request(app).get("/api/tickers").expect(401);
    await request(app).post("/api/analyze").send({ticker:"INFY"}).expect(401);
  });
  it("requires approval, permits admin-only changes, revokes immediately, resets passwords and logs audit",async()=>{
    const app=createApp(),agent=request.agent(app),admin=request(app);
    await agent.post("/api/auth/register").send({email:"new@example.test",password:"new-test-password",liveApproved:true}).expect(400);
    await agent.post("/api/auth/register").send({email:"new@example.test",password:"new-test-password"}).expect(201);
    const login=await agent.post("/api/auth/login").send({email:"NEW@example.test",password:"new-test-password"}).expect(200);
    expect(login.body.user.liveApproved).toBe(false);expect(login.headers["set-cookie"][0]).toContain("HttpOnly");expect(login.headers["set-cookie"][0]).toContain("SameSite=Lax");
    const id=login.body.user.id;
    await agent.get("/api/tickers?mode=live").expect(403);
    await agent.post(`/api/admin/users/${id}`).send({action:"approve"}).expect(401);
    await admin.post(`/api/admin/users/${id}`).auth(email,password).set("Origin","https://evil.test").send({action:"approve"}).expect(403);
    await admin.post(`/api/admin/users/${id}`).auth(email,password).send({action:"approve"}).expect(200);
    expect((await agent.get("/api/auth/me")).body.user.liveApproved).toBe(true);
    await agent.post("/api/auth/renew").send({}).expect(200);
    await admin.post(`/api/admin/users/${id}`).auth(email,password).send({action:"revoke"}).expect(200);
    expect((await agent.get("/api/auth/me")).body.user).toBeNull();
    expect(()=>runWithVisitor(id,()=>reserveOpenAiCall())).toThrow("revoked");
    await agent.post("/api/auth/login").send({email:"new@example.test",password:"new-test-password"}).expect(200);
    await agent.get("/api/tickers?mode=live").expect(403);
    await admin.post(`/api/admin/users/${id}`).auth(email,password).send({action:"resetPassword",password:"replacement-test-password"}).expect(200);
    expect((await agent.get("/api/auth/me")).body.user).toBeNull();
    await agent.post("/api/auth/login").send({email:"new@example.test",password:"new-test-password"}).expect(401);
    await agent.post("/api/auth/login").send({email:"new@example.test",password:"replacement-test-password"}).expect(200);
    await agent.post("/api/auth/logout").send({}).expect(200);
    expect((await agent.get("/api/auth/me")).body.user).toBeNull();
    expect((getDb().prepare("SELECT COUNT(*) n FROM user_access_audit").get() as {n:number}).n).toBe(3);
    const list=await admin.get("/api/admin/users").auth(email,password).expect(200);
    expect(JSON.stringify(list.body)).not.toContain("password");
    await admin.get("/api/admin/users?page=-1").auth(email,password).expect(400);
  });
  it("rejects expired and forged sessions, cross-site login, weak signup and duplicate emails",async()=>{
    const app=createApp(),agent=request.agent(app);
    await agent.post("/api/auth/login").set("Origin","https://evil.test").send({email,password}).expect(403);
    await agent.post("/api/auth/register").send({email:"weak@example.test",password:"short"}).expect(400);
    await agent.post("/api/auth/register").send({email,password}).expect(409);
    const response=await agent.post("/api/auth/login").send({email,password}).expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    getDb().prepare("UPDATE user_sessions SET expires_at=?").run(Date.now()-1);
    expect((await agent.get("/api/auth/me")).body.user).toBeNull();
    await agent.post("/api/auth/renew").send({}).expect(401);
    const forged=await request(app).get("/api/auth/me").set("Cookie","vf_account="+"a".repeat(64));expect(forged.body.user).toBeNull();
    await request(app).post("/api/auth/login").send({email:"absent@example.test",password}).expect(401);
  });
});
