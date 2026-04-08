export type NavigatorOpts = {
  totalPlies: number;
  onChange: (ply: number) => void;
};

export class Navigator {
  private totalPlies: number;
  private ply: number = 0;
  private onChange: (ply: number) => void;

  constructor(opts: NavigatorOpts) {
    this.totalPlies = opts.totalPlies;
    this.onChange = opts.onChange;
  }

  setBounds(totalPlies: number) {
    this.totalPlies = Math.max(0, totalPlies|0);
    if (this.ply > this.totalPlies) this.setPly(this.totalPlies);
  }

  getPly() { return this.ply; }
  getTotal() { return this.totalPlies; }

  setPly(n: number) {
    const clamped = Math.max(0, Math.min(n|0, this.totalPlies));
    if (clamped !== this.ply) {
      this.ply = clamped;
      this.onChange(this.ply);
    }
  }
  next() { this.setPly(this.ply + 1); }
  prev() { this.setPly(this.ply - 1); }
  home() { this.setPly(0); }
  end()  { this.setPly(this.totalPlies); }
}
