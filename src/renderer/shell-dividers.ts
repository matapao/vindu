import type { Placement } from '../layout.js';

type DividerHost = {
  title(view: string): string;
  label(first: string, second: string): string;
  resize(path: number[], sizes: number[]): boolean;
  commit(path: number[], sizes: number[]): void;
  layout(): void;
};

const same = (a: number[], b: number[]) => a.length === b.length && a.every((value, i) => value === b[i]);

/** Move the boundary between two neighbours while respecting the minimum size on either side. */
export function moveLine(extents: number[], mins: number[], index: number, delta: number): number[] {
  const left = extents[index];
  const right = extents[index + 1];
  const lower = mins[index] - left,
    upper = right - mins[index + 1];
  if (lower > upper) return [...extents]; // too narrow for both minimums already: the line stays where it is
  const change = Math.max(lower, Math.min(upper, Math.round(delta)));
  const sizes = [...extents];
  sizes[index] = left + change;
  sizes[index + 1] = right - change;
  return sizes;
}

function equalSizes(extents: number[], index: number): number[] {
  const sizes = [...extents];
  const total = sizes[index] + sizes[index + 1];
  sizes[index] = Math.ceil(total / 2);
  sizes[index + 1] = total - sizes[index];
  return sizes;
}

/** Keyboard and pointer resizing share the same bounds and change the same pair of panes. */
export function mountDividers(root: HTMLElement, desk: HTMLElement, host: DividerHost) {
  let placement: Placement;
  let lines: HTMLElement[] = [];
  let previousKey = '';
  let dragging = false;
  const splitOf = (path: number[]) => placement.splits.find((split) => same(split.path, path));

  function divider(index: number) {
    const element = desk.ownerDocument.createElement('div');
    element.className = 'vindu-line';
    element.tabIndex = 0;
    element.setAttribute('role', 'separator');
    element.setAttribute('aria-valuemin', '0');
    element.setAttribute('aria-valuemax', '100');
    const { path, index: child } = placement.lines[index];
    const titles = (child: number) =>
      splitOf(path)
        ? placement.panes
            .filter((p) => same(p.path.slice(0, path.length + 1), [...path, child]))
            .map((p) => host.title(p.view))
            .join(' + ')
        : '';
    element.setAttribute('aria-label', host.label(titles(child), titles(child + 1)));

    element.addEventListener('pointerdown', (event) => {
      const line = placement.lines[index];
      const split = splitOf(line.path);
      if (event.button !== 0 || !split) return;
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      element.classList.add('is-drag');
      root.classList.add('is-dragging');
      dragging = true;
      const position = (e: PointerEvent) => (line.dir === 'row' ? e.clientX : e.clientY);
      const start = position(event);
      const extents = [...split.extents];
      const mins = [...split.mins];
      let sizes: number[] | undefined;

      function move(event: PointerEvent) {
        sizes = moveLine(extents, mins, line.index, position(event) - start);
        host.resize(line.path, sizes);
        host.layout();
      }
      function release() {
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerup', release);
        element.removeEventListener('pointercancel', release);
        element.classList.remove('is-drag');
        root.classList.remove('is-dragging');
        dragging = false;
        if (sizes && !same(sizes, extents)) host.commit(line.path, sizes);
        host.layout();
      }
      element.addEventListener('pointermove', move);
      element.addEventListener('pointerup', release);
      element.addEventListener('pointercancel', release);
    });

    const setSizes = (path: number[], sizes: number[]) => {
      if (!host.resize(path, sizes)) return;
      host.layout();
      host.commit(path, sizes);
    };
    element.addEventListener('keydown', (event) => {
      const line = placement.lines[index];
      const split = splitOf(line.path);
      if (!split) return;
      const back = line.dir === 'row' ? 'ArrowLeft' : 'ArrowUp';
      const forward = line.dir === 'row' ? 'ArrowRight' : 'ArrowDown';
      if (event.key !== back && event.key !== forward && event.key !== 'Enter') return;
      event.preventDefault();
      const delta = (event.key === forward ? 1 : -1) * (event.shiftKey ? 96 : 24);
      setSizes(
        line.path,
        event.key === 'Enter'
          ? equalSizes(split.extents, line.index)
          : moveLine(split.extents, split.mins, line.index, delta),
      );
    });
    element.addEventListener('dblclick', () => {
      const line = placement.lines[index];
      const split = splitOf(line.path);
      if (split) setSizes(line.path, equalSizes(split.extents, line.index));
    });
    desk.append(element);
    return element;
  }

  function render(current: Placement) {
    placement = current;
    const key = current.lines.map((line) => `${line.path.join('.')}:${line.index}:${line.dir}`).join('|');
    if (key !== previousKey && !dragging) {
      lines.forEach((element) => element.remove());
      lines = current.lines.map((_, index) => divider(index));
      previousKey = key;
    }
    current.lines.forEach((line, i) => {
      const element = lines[i];
      if (!element) return;
      const { x, y, w, h } = line.box;
      Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      element.dataset.dir = line.dir;
      element.setAttribute('aria-orientation', line.dir === 'row' ? 'vertical' : 'horizontal');
      const split = splitOf(line.path);
      if (split) {
        const width = split.extents[line.index];
        element.setAttribute(
          'aria-valuenow',
          String(Math.round((100 * width) / (width + split.extents[line.index + 1]))),
        );
      }
    });
  }

  return {
    render,
    get dragging() {
      return dragging;
    },
  };
}
