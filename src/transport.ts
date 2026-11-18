export type LinkState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(command: string): Promise<void>;
  onLine(listener: (line: string) => void): void;
  onLinkState(listener: (state: LinkState) => void): void;
}

// Maliit na helper para sa mga listener, gamit ng ble.ts at demo.ts
export class Emitter<T> {
  private listeners: ((value: T) => void)[] = [];

  add(listener: (value: T) => void): void {
    this.listeners.push(listener);
  }

  emit(value: T): void {
    for (const l of this.listeners) l(value);
  }
}
