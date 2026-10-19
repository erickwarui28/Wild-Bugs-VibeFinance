import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { API_BASE } from "./api";
export type Account = {id:string;email:string;liveApproved:boolean;isAdmin:boolean};
const origin = new URL(API_BASE || location.origin,location.origin).origin;
export const accountSite = import.meta.env.DEV || origin===location.origin;
export const accountUrl = (path="login") => `${origin}${import.meta.env.BASE_URL}#/${path}`;
const Context=createContext<{user:Account|null;ready:boolean;refresh:()=>Promise<void>;logout:()=>Promise<void>}>({user:null,ready:false,refresh:async()=>{},logout:async()=>{}});
export const useAccount=()=>useContext(Context);
export async function accountRequest(path:string,body?:object){
  const response=await fetch(`${API_BASE}/api/auth/${path}`,{method:body?"POST":"GET",credentials:"include",cache:"no-store",
    headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const result=await response.json() as {user?:Account|null;message?:string;error?:string};
  if(!response.ok)throw Error(result.error||"Account request failed. Please retry.");return result;
}
export function AccountProvider({children}:{children:ReactNode}){
  const [user,setUser]=useState<Account|null>(null),[ready,setReady]=useState(false);
  async function refresh(){try{if(accountSite)setUser((await accountRequest("me")).user??null);}finally{setReady(true);}}
  async function logout(){await accountRequest("logout",{});setUser(null);}
  useEffect(()=>{
    let stopped=false;
    async function sync(){try{if(accountSite){const d=await accountRequest("me");if(!stopped)setUser(d.user??null);}}catch{if(!stopped)setUser(null);}finally{if(!stopped)setReady(true);}}
    void sync();const id=setInterval(()=>void sync(),30000);
    const focus=()=>void sync();window.addEventListener("focus",focus);
    return()=>{stopped=true;clearInterval(id);window.removeEventListener("focus",focus);};
  },[]);
  return <Context.Provider value={{user,ready,refresh,logout}}>{children}</Context.Provider>;
}
