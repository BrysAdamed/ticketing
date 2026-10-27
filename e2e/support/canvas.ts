/// Excalidraw scenes for seeding Canvas diagrams through the API, as an LLM or another client
/// would store them (no picture: the first writer who opens the diagram renders it).

interface Element {
    [key: string]: unknown;
}

let seed = 1;

function base(
    id: string,
    type: string,
    x: number,
    y: number,
    width: number,
    height: number,
): Element {
    return {
        id,
        type,
        x,
        y,
        width,
        height,
        angle: 0,
        strokeColor: '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: seed++,
        version: 1,
        versionNonce: seed++,
        isDeleted: false,
        boundElements: [],
        updated: 1,
        link: null,
        locked: false,
    };
}

function label(id: string, container: Element, text: string): Element {
    const width = text.length * 11;
    return {
        ...base(
            id,
            'text',
            (container.x as number) + ((container.width as number) - width) / 2,
            (container.y as number) + (container.height as number) / 2 - 12,
            width,
            25,
        ),
        text,
        originalText: text,
        fontSize: 20,
        fontFamily: 5,
        textAlign: 'center',
        verticalAlign: 'middle',
        containerId: container.id,
        autoResize: true,
        lineHeight: 1.25,
    };
}

function box(id: string, x: number, y: number, text: string): Element[] {
    const shape = base(id, 'rectangle', x, y, 160, 70);
    const text_ = label(`${id}-label`, shape, text);
    shape.boundElements = [{ id: text_.id, type: 'text' }];
    return [shape, text_];
}

function arrow(id: string, from: Element, to: Element): Element {
    const startX = (from.x as number) + (from.width as number);
    const startY = (from.y as number) + (from.height as number) / 2;
    const endX = to.x as number;
    const endY = (to.y as number) + (to.height as number) / 2;
    (from.boundElements as unknown[]).push({ id, type: 'arrow' });
    (to.boundElements as unknown[]).push({ id, type: 'arrow' });
    return {
        ...base(id, 'arrow', startX, startY, endX - startX, endY - startY),
        points: [
            [0, 0],
            [endX - startX, endY - startY],
        ],
        startBinding: { elementId: from.id, focus: 0, gap: 4 },
        endBinding: { elementId: to.id, focus: 0, gap: 4 },
        startArrowhead: null,
        endArrowhead: 'arrow',
        elbowed: false,
    };
}

function scene(elements: Element[]): string {
    return JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'https://ticketing.e2e',
        elements,
        appState: { viewBackgroundColor: '#ffffff', gridSize: 20 },
        files: {},
    });
}

/// Boxes labelled with `labels`, left to right, each joined to the next by a bound arrow.
export function chainScene(...labels: string[]): string {
    const boxes = labels.map((text, i) => box(`box-${i}`, i * 280, 0, text));
    const arrows = boxes.slice(1).map((b, i) => arrow(`arrow-${i}`, boxes[i][0], b[0]));
    return scene([...boxes.flat(), ...arrows]);
}

/// A grid of labelled boxes and arrows with exactly `count` elements.
export function largeScene(count: number): string {
    const elements: Element[] = [];
    const columns = 25;
    for (let i = 0; elements.length + 3 <= count; i++) {
        const x = (i % columns) * 220;
        const y = Math.floor(i / columns) * 140;
        const [shape, text] = box(`b${i}`, x, y, `Node ${i}`);
        elements.push(shape, text);
        const previous = i % columns === 0 ? null : elements[elements.length - 5];
        if (previous) elements.push(arrow(`a${i}`, previous, shape));
        else elements.push({ ...base(`f${i}`, 'ellipse', x - 60, y + 20, 30, 30) });
    }
    while (elements.length < count)
        elements.push(base(`pad${elements.length}`, 'diamond', -200, elements.length * 50, 40, 40));
    return scene(elements);
}
