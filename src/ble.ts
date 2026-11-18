// Totoong koneksyon sa HM-10 gamit ang Web Bluetooth.
import { LineBuffer } from './protocol';
import { Emitter, type LinkState, type Transport } from './transport';

const SERVICE = 0xffe0;
const CHARACTERISTIC = 0xffe1;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const MAX_WRITE_BYTES = 20; // laki ng isang BLE packet ng HM-10

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function hasWebBluetooth(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

export class BleTransport implements Transport {
  private device: BluetoothDevice | null = null;
  private char: BluetoothRemoteGATTCharacteristic | null = null;
  private readonly lines = new Emitter<string>();
  private readonly states = new Emitter<LinkState>();
  private decoder = new TextDecoder();
  private readonly buffer = new LineBuffer((line) => this.lines.emit(line));
  private encoder = new TextEncoder();
  private writeQueue: Promise<void> = Promise.resolve();
  private userDisconnected = false;
  private retrying = false;

  onLine(listener: (line: string) => void): void {
    this.lines.add(listener);
  }

  onLinkState(listener: (state: LinkState) => void): void {
    this.states.add(listener);
  }

  // Dapat tawagin mula lang sa pag-tap ng user (patakaran ng browser).
  async connect(): Promise<void> {
    const bt = navigator.bluetooth;
    if (!bt) throw new Error('Walang Web Bluetooth');
    this.userDisconnected = false;
    this.states.emit('connecting');

    try {
      // Maraming HM-10 clone ang hindi nag-a-advertise ng service, kaya may name filters
      const device = await bt.requestDevice({
        filters: [
          { services: [SERVICE] },
          { namePrefix: 'HM' },
          { namePrefix: 'BT05' },
          { namePrefix: 'MLT' },
          { namePrefix: 'JDY' },
          { namePrefix: 'AT-09' },
          { namePrefix: 'CC41' },
        ],
        optionalServices: [SERVICE],
      });

      if (this.device !== device) {
        this.device?.removeEventListener('gattserverdisconnected', this.handleDisconnect);
        this.device = device;
        device.addEventListener('gattserverdisconnected', this.handleDisconnect);
      }

      await this.openGatt();
      this.states.emit('connected');
    } catch (err) {
      // Kapag kinansela ng user ang picker, bumalik lang sa "idle"
      const cancelled = err instanceof DOMException && err.name === 'NotFoundError';
      this.states.emit(cancelled ? 'idle' : 'failed');
      if (!cancelled) console.error(err);
    }
  }

  async disconnect(): Promise<void> {
    this.userDisconnected = true;
    this.char?.removeEventListener('characteristicvaluechanged', this.handleValue);
    this.char = null;
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.states.emit('idle');
  }

  send(command: string): Promise<void> {
    // Isa-isa ang writes: bawal ang sabay na GATT operation
    const job = this.writeQueue.then(() => this.write(command));
    this.writeQueue = job.catch((err) => console.warn('Hindi naipadala:', command.trim(), err));
    return job;
  }

  private async write(command: string): Promise<void> {
    const char = this.char;
    if (!char) throw new Error('Hindi connected');
    const bytes = this.encoder.encode(command);
    for (let i = 0; i < bytes.length; i += MAX_WRITE_BYTES) {
      const chunk = bytes.slice(i, i + MAX_WRITE_BYTES);
      if (char.writeValueWithoutResponse && char.properties.writeWithoutResponse) {
        await char.writeValueWithoutResponse(chunk);
      } else {
        await char.writeValue(chunk);
      }
    }
  }

  private async openGatt(): Promise<void> {
    const gatt = this.device?.gatt;
    if (!gatt) throw new Error('Walang GATT ang device');
    const server = await gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    const char = await service.getCharacteristic(CHARACTERISTIC);

    this.char?.removeEventListener('characteristicvaluechanged', this.handleValue);
    this.char = char;
    this.decoder = new TextDecoder();
    this.buffer.reset();
    char.addEventListener('characteristicvaluechanged', this.handleValue);
    await char.startNotifications();

    // Hingin agad ang status pagkakonekta
    this.writeQueue = Promise.resolve();
    await this.send('#S\n');
  }

  private handleValue = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    // stream: true para hindi masira ang character na nahati sa dalawang packet.
    // Puwedeng kalahating linya lang ito; ang LineBuffer ang magdudugtong.
    this.buffer.push(this.decoder.decode(value, { stream: true }));
  };

  private handleDisconnect = (): void => {
    this.char = null;
    if (this.userDisconnected || this.retrying) return;
    void this.reconnect();
  };

  private async reconnect(): Promise<void> {
    this.retrying = true;
    this.states.emit('reconnecting');
    for (const delay of RETRY_DELAYS_MS) {
      await sleep(delay);
      if (this.userDisconnected) break;
      try {
        await this.openGatt();
        this.retrying = false;
        this.states.emit('connected');
        return;
      } catch (err) {
        console.warn('Bigo ang pagkonekta ulit:', err);
      }
    }
    this.retrying = false;
    if (!this.userDisconnected) this.states.emit('failed');
  }
}
