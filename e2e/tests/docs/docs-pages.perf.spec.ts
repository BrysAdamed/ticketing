import { DocPagePage } from '../../pages/doc-page.page';
import { expect, test } from '../../support/fixtures';

/// Budgets of spec 12.8. Timings are only meaningful without other tests running in parallel, so
/// `*.perf.spec.ts` files live in the `perf` project and run on request:
/// `E2E_PERF=1 npx playwright test --project=perf`.
test('a 100 000-character page renders in under 500 ms and typing stays under 16 ms', async ({
    page,
    api,
}) => {
    test.skip(process.env.E2E_PERF !== '1', 'Set E2E_PERF=1 and run the perf project alone.');

    // Arrange
    const projectKey = (await api.createProject()).key;
    const sections = Array.from(
        { length: 700 },
        (_, i) =>
            `## Section ${i}\n\nSome **bold** text with \`code\`, a [link](https://example.com) and WEB-${i}.\n\n- item one\n- item two\n\n| a | b |\n| --- | --- |\n| ${i} | x |\n`,
    );
    const content = sections.join('\n').slice(0, 99_000);
    const doc = await api.post<{ key: string }>(`/projects/${projectKey}/docs`, {
        kind: 'Page',
        title: 'Big page',
        content,
    });
    const view = new DocPagePage(page);

    // Act: open it
    const started = Date.now();
    await view.goto(projectKey, doc.key);
    await expect(view.content.locator('h2').last()).toBeAttached();
    const openMs = Date.now() - started;
    const renderMs = await page.evaluate(() =>
        Math.max(...performance.getEntriesByName('tk-doc-markdown').map((e) => e.duration)),
    );

    // Act: type in the split editor three times, measuring the main thread's CPU time (scripts,
    // style, layout, paint) per keystroke (best round) and the longest event handler
    const editorMs = await page.evaluate(
        () =>
            new Promise<number>((resolve) => {
                const started = performance.now();
                document.body.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'e', bubbles: true }),
                );
                const ready = () =>
                    document.querySelector('[data-testid="doc-editor-source"] .cm-line') &&
                    document.querySelectorAll('[data-testid="doc-editor-preview"] > h2').length >
                        600;
                const poll = () =>
                    ready() ? resolve(performance.now() - started) : requestAnimationFrame(poll);
                requestAnimationFrame(poll);
            }),
    );
    await expect(view.source).toBeVisible();
    await view.source.locator('.cm-line').first().click();
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
        const handlers: number[] = [];
        (window as unknown as { handlers: number[] }).handlers = handlers;
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as PerformanceEventTiming[])
                handlers.push(entry.processingEnd - entry.processingStart);
        }).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const cpu = async () =>
        (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'ThreadTime')!
            .value * 1000;
    const typed = 'Typing into a long page stays fast. ';
    const rounds: number[] = [];
    for (let round = 0; round < 3; round++) {
        const before = await cpu();
        await page.keyboard.type(typed, { delay: 30 });
        rounds.push(((await cpu()) - before) / typed.length);
    }
    const perKey = Math.min(...rounds);
    const handlers = await page.evaluate(
        () => (window as unknown as { handlers: number[] }).handlers,
    );
    const longestHandler = Math.max(0, ...handlers);

    // Assert
    console.log(
        `100k page: render ${renderMs.toFixed(1)} ms, open ${openMs} ms, editor ${editorMs.toFixed(0)} ms; typing ${rounds.map((r) => r.toFixed(1)).join(' / ')} ms of main-thread work per keystroke, longest handler ${longestHandler.toFixed(1)} ms`,
    );
    expect(content.length).toBeGreaterThan(95_000);
    expect(renderMs).toBeLessThan(500);
    expect(perKey).toBeLessThan(16);
    expect(longestHandler).toBeLessThan(16);
});
