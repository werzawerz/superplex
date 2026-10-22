// "Save & sync" panel (opened with the ☁ button on the main menu) and the background sync:
// players with a sync code are merged with their cloud save when the menu opens and after
// every level.
import type { Players } from '../ui/players';
import { cloudAvailable, cloudLoad, cloudSave, exportSaveCode, mergeInto, newSyncCode, normalizeCode, parseSaveCode, toSaved, type SavedPlayer } from '../ui/sync';

/** Same progress (the name may differ per device)? */
const sameProgress = (a: SavedPlayer, b: SavedPlayer) =>
  a.levels === b.levels && a.hours === b.hours && a.minutes === b.minutes && a.seconds === b.seconds && a.completedAllLevels === b.completedAllLevels;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Cloud {
  /** Called after synced data changed the players (the menu redraws). */
  onChange: () => void = () => {};
  private busy = false;

  constructor(private readonly players: Players) {
    $('cloudBtn').addEventListener('click', () => this.open());
    $('cloudClose').addEventListener('click', () => this.close());
    $('cloudMake').addEventListener('click', () => void this.enableSync());
    $('cloudCopy').addEventListener('click', () => void this.copy(this.players.player.syncCode ?? ''));
    $('cloudLink').addEventListener('click', () => void this.link());
    $('cloudExport').addEventListener('click', () => void this.copy(exportSaveCode(this.players.list, this.players.hallOfFame), 'Save code copied — paste it with “Load save code” on the other device.'));
    $('cloudImport').addEventListener('click', () => this.importCode());
    // Typing in the panel must not reach the game's keyboard handling.
    $('cloud').addEventListener('keydown', (e) => e.stopPropagation());
  }

  get isOpen(): boolean {
    return !$('cloud').hidden;
  }

  setButtonVisible(v: boolean): void {
    $('cloudBtn').hidden = !v;
    if (!v) this.close();
  }

  private status(text: string): void {
    $('cloudStatus').textContent = text;
  }

  open(): void {
    const p = this.players.player;
    $('cloud').hidden = false;
    $('cloudPlayer').textContent = this.players.hasPlayer ? `Player: ${p.name.trim()}` : 'No player selected';
    $('cloudCode').textContent = p.syncCode ?? '—';
    $('cloudCopy').hidden = !p.syncCode;
    $('cloudMake').hidden = !!p.syncCode || !this.players.hasPlayer;
    $<HTMLInputElement>('cloudInput').value = '';
    this.status(cloudAvailable() ? '' : 'Cloud sync is not available in this build.');
  }

  close(): void {
    $('cloud').hidden = true;
  }

  private async copy(text: string, done = 'Copied.'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.status(done);
    } catch {
      window.prompt('Copy this:', text);
    }
  }

  /** Gives the current player a sync code and uploads its progress. */
  private async enableSync(): Promise<void> {
    const p = this.players.player;
    if (!this.players.hasPlayer || p.syncCode) return;
    const code = newSyncCode();
    this.status('Saving…');
    try {
      await cloudSave(code, p);
      p.syncCode = code;
      this.players.save();
      this.open();
      this.status('Sync is on. Enter this code on your other device (☁ → Link).');
    } catch (e) {
      this.status((e as Error).message);
    }
  }

  /** Links a code from another device: downloads that player and merges it in here. */
  private async link(): Promise<void> {
    const code = normalizeCode($<HTMLInputElement>('cloudInput').value);
    if (!code) {
      this.status('A sync code looks like ABCD-EFGH-JKLM.');
      return;
    }
    this.status('Loading…');
    try {
      const saved = await cloudLoad(code);
      if (!saved) {
        this.status('Nothing is saved under this code.');
        return;
      }
      const slot = this.players.importPlayer(saved, code);
      if (slot < 0) {
        this.status('PLAYER LIST FULL — delete a player first.');
        return;
      }
      this.players.current = slot;
      this.players.prepareLevelData(true);
      this.players.save();
      // Send back the merged progress (this device may have had some already).
      await cloudSave(code, this.players.list[slot]!);
      this.onChange();
      this.open();
      this.status(`Linked: ${saved.name.trim()} is now synced on this device.`);
    } catch (e) {
      this.status((e as Error).message);
    }
  }

  private importCode(): void {
    const text = window.prompt('Paste the save code:');
    if (!text) return;
    const d = parseSaveCode(text);
    if (!d) {
      this.status('That is not a save code.');
      return;
    }
    let n = 0;
    for (const s of d.players) if (this.players.importPlayer(s) >= 0) n++;
    if (d.hallOfFame.length === 3 && this.players.hallOfFame.every((e) => !e.name)) this.players.hallOfFame = d.hallOfFame;
    this.players.prepareLevelData(true);
    this.players.save();
    this.onChange();
    this.open();
    this.status(`Loaded ${n} player${n === 1 ? '' : 's'}.`);
  }

  /** Merges every synced player with its cloud save, both ways. Quiet: errors only skip. */
  async syncAll(): Promise<void> {
    if (!cloudAvailable() || this.busy) return;
    this.busy = true;
    let changed = false;
    try {
      for (const p of this.players.list) {
        if (!p.syncCode) continue;
        try {
          const saved = await cloudLoad(p.syncCode);
          if (saved && mergeInto(p, saved)) changed = true;
          // Upload if the cloud is missing anything this device has.
          if (!saved || !sameProgress(saved, toSaved(p))) await cloudSave(p.syncCode, p);
        } catch {
          /* offline: try again later */
        }
      }
    } finally {
      this.busy = false;
    }
    if (changed) {
      this.players.prepareLevelData(false);
      this.players.save();
      this.onChange();
    }
  }
}
