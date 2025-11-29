export {};
declare global { interface Window { coach?: { generate: (inputs:any)=>Promise<{notes?:any; offline?:boolean}> } } };
