export interface HistoryState<T> {
  present: T;
  undoDepth: number;
  redoDepth: number;
}

export class TransactionHistory<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private current: T, private readonly limit = 30) {}

  get value(): T {
    return this.current;
  }

  commit(mutator: (draft: T) => void): HistoryState<T> {
    const before = structuredClone(this.current);
    const next = structuredClone(this.current);
    mutator(next);
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    this.future = [];
    return this.snapshot();
  }

  replace(next: T): HistoryState<T> {
    this.past = [];
    this.future = [];
    this.current = structuredClone(next);
    return this.snapshot();
  }

  undo(): HistoryState<T> {
    const previous = this.past.pop();
    if (!previous) return this.snapshot();
    this.future.push(structuredClone(this.current));
    if (this.future.length > this.limit) this.future.shift();
    this.current = previous;
    return this.snapshot();
  }

  redo(): HistoryState<T> {
    const next = this.future.pop();
    if (!next) return this.snapshot();
    this.past.push(structuredClone(this.current));
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    return this.snapshot();
  }

  snapshot(): HistoryState<T> {
    return { present: this.current, undoDepth: this.past.length, redoDepth: this.future.length };
  }
}
