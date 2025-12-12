export {};
declare global {
  interface Window {
    electron?: {
      invoke?: (channel: string, payload?: any) => Promise<any>;
      engine?: { reviewFast?: (fens: string[], elo: number, opts?: any) => Promise<any> };
    };
    engine?: {
      analyzeFen?: (fen: string, opts?: any) => Promise<any>;
      reviewPgn?: (pgn: string, opts?: any) => Promise<any>;
      identifyOpening?: (fen: string) => Promise<any>;
      getCapabilities?: () => Promise<any>;
      setStrength?: (payload: { elo: number }) => Promise<any>;
      reviewFast?: (fens: string[], opts?: any) => Promise<any>;
      ping?: () => Promise<any>;
      panic?: () => Promise<any>;
    };
    coach?: { generate: (inputs:any)=>Promise<{notes?:any; offline?:boolean}> };
    appSettings?: {
      get?: () => Promise<any>;
      update?: (patch: any) => Promise<any>;
    };
  }
}
