export {};
declare global {
  interface Window {
    electron?: {
      invoke?: (channel: string, payload?: any) => Promise<any>;
      engine?: { reviewFast?: (fens: string[], elo: number, opts?: any) => Promise<any> };
    };
    coach?: { generate: (inputs:any)=>Promise<{notes?:any; offline?:boolean}> };
  }
}
