/// How far outside the viewport an element starts rendering, so it is usually ready when it
/// scrolls in.
const ROOT_MARGIN = '600px 0px';

const waiting = new Map<Element, () => void>();
let observer: IntersectionObserver | null = null;

/// Resolves when `element` comes within `ROOT_MARGIN` of the viewport (one shared
/// IntersectionObserver), or right away where there is none (tests, the PDF bundle). Also resolves
/// when `signal` aborts; the caller checks `signal.aborted`. Free of Angular.
export function whenVisible(element: Element, signal?: AbortSignal): Promise<void> {
  if (typeof IntersectionObserver === 'undefined' || signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      waiting.delete(element);
      observer?.unobserve(element);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    waiting.get(element)?.();
    waiting.set(element, done);
    signal?.addEventListener('abort', done, { once: true });
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) waiting.get(entry.target)?.();
      },
      { rootMargin: ROOT_MARGIN },
    );
    observer.observe(element);
  });
}
