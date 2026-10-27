import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../notify/toast.service';
import { DocExports, pdfFileName } from './doc-export';
import { DocsApi } from './docs.api';

describe('pdfFileName', () => {
  it('prefers the UTF-8 name of a Content-Disposition header', () => {
    expect(
      pdfFileName(
        `attachment; filename="PAY-Zaz_o_-2026-10-27.pdf"; filename*=UTF-8''PAY-Za%C5%BC%C3%B3%C5%82%C4%87-2026-10-27.pdf`,
      ),
    ).toBe('PAY-Zażółć-2026-10-27.pdf');
    expect(pdfFileName('attachment; filename="PAY-Plan.pdf"')).toBe('PAY-Plan.pdf');
    expect(pdfFileName(null)).toBeNull();
  });
});

describe('DocExports', () => {
  const toast = { show: vi.fn(), success: vi.fn(), error: vi.fn() };
  const api = { pdfExportUrl: vi.fn((key: string) => `/api/v1/docs/${key}/export.pdf`) };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:pdf');
    URL.revokeObjectURL = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: DocsApi, useValue: api },
      ],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  const pdf = () =>
    new Response(new Blob(['%PDF']), {
      status: 200,
      headers: { 'Content-Disposition': 'attachment; filename="PAY-Plan.pdf"' },
    });

  it('downloads a page at once and a folder from the toast when it is ready', async () => {
    // Arrange
    const exports = TestBed.inject(DocExports);
    fetchMock.mockResolvedValueOnce(pdf()).mockResolvedValueOnce(pdf());
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    // Act
    await exports.export({ key: 'PAY-D-1', title: 'Plan', kind: 'Page' });
    await exports.export({ key: 'PAY-D-2', title: 'Architecture', kind: 'Folder' });

    // Assert
    expect(click).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Downloaded PAY-Plan.pdf');
    const ready = toast.success.mock.calls[1];
    expect(ready[0]).toBe('The PDF of "Architecture" is ready');
    ready[1].action.run();
    expect(click).toHaveBeenCalledTimes(2);
    expect(exports.exporting().size).toBe(0);
  });

  it('shows the server problem, for example busy, and allows one export per doc at a time', async () => {
    // Arrange
    const exports = TestBed.inject(DocExports);
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));

    // Act
    const first = exports.export({ key: 'PAY-D-1', title: 'Plan', kind: 'Page' });
    await exports.export({ key: 'PAY-D-1', title: 'Plan', kind: 'Page' });
    const busyWhileRunning = exports.isExporting('PAY-D-1');
    answer(
      new Response(
        JSON.stringify({ code: 'doc.export.busy', title: 'Too many PDF exports are running.' }),
        { status: 429, headers: { 'Retry-After': '15' } },
      ),
    );
    await first;

    // Assert
    expect(busyWhileRunning).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith('Already exporting "Plan"');
    const error = toast.error.mock.calls[0][0];
    expect(error.code).toBe('doc.export.busy');
    expect(error.retryAfterSeconds).toBe(15);
    expect(exports.isExporting('PAY-D-1')).toBe(false);
  });
});
