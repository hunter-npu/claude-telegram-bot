export interface SessionRecord {
  id: string;
  prompt: string;
  createdAt: Date;
}

export class SessionManager {
  private sessions: SessionRecord[] = [];
  private currentId: string | null = null;

  /** Register or update the current active session */
  setCurrent(id: string, prompt: string): void {
    this.currentId = id;
    const existing = this.sessions.find((s) => s.id === id);
    if (!existing) {
      this.sessions.push({ id, prompt, createdAt: new Date() });
    }
  }

  /** Get the current active session, if any */
  getCurrent(): SessionRecord | null {
    if (!this.currentId) return null;
    return this.sessions.find((s) => s.id === this.currentId) ?? null;
  }

  /** Clear the current session pointer */
  clearCurrent(): void {
    this.currentId = null;
  }

  /** List all sessions, most recent first */
  list(): SessionRecord[] {
    return [...this.sessions].reverse();
  }

  /** Look up a session by its ID */
  getById(id: string): SessionRecord | undefined {
    return this.sessions.find((s) => s.id === id);
  }
}
