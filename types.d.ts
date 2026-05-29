// Declaraciones de módulos sin tipos oficiales
declare module "gtts" {
  class Gtts {
    constructor(text: string, lang: string);
    save(path: string, callback: (err: Error | null) => void): void;
  }
  export = Gtts;
}

declare module "@retconned/kick-js" {
  interface KickClient {
    login(options: {
      type: string;
      credentials: Record<string, string>;
    }): Promise<void>;
    on(event: string, handler: (...args: unknown[]) => void): void;
  }
  export function createClient(channel: string, options?: { logger?: boolean }): KickClient;
}
