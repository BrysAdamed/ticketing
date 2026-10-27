import type { MermaidConfig } from 'mermaid';
import { DiagramTheme } from '../diagram-theme';

const FONT_FAMILY = "'Inter Variable', Inter, system-ui, sans-serif";

const SECURE_KEYS = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'maxEdges',
  'suppressErrorRendering',
  'htmlLabels',
  'dompurifyConfig',
];

const THEME_VARIABLES: Record<DiagramTheme, Record<string, string | boolean>> = {
  light: {
    darkMode: false,
    background: '#ffffff',
    edgeLabelBackground: '#ffffff',
    clusterBkg: '#f7f7f8',
    clusterBorder: '#dedfe4',
    primaryColor: '#f0f1fd',
    primaryBorderColor: '#8188e6',
    primaryTextColor: '#1a1b1f',
    secondaryColor: '#efeff2',
    tertiaryColor: '#f7f7f8',
    lineColor: '#62656e',
    textColor: '#1a1b1f',
    noteBkgColor: '#fdf6e3',
    noteBorderColor: '#e8a317',
    fontFamily: FONT_FAMILY,
    fontSize: '14px',
  },
  dark: {
    darkMode: true,
    background: '#151619',
    edgeLabelBackground: '#151619',
    clusterBkg: '#1a1b1f',
    clusterBorder: '#36383f',
    primaryColor: '#1e1f40',
    primaryBorderColor: '#6169db',
    primaryTextColor: '#ececef',
    secondaryColor: '#212226',
    tertiaryColor: '#1a1b1f',
    lineColor: '#a4a6af',
    textColor: '#ececef',
    noteBkgColor: '#2a2414',
    noteBorderColor: '#9a5b00',
    fontFamily: FONT_FAMILY,
    fontSize: '14px',
  },
};

/// The one Mermaid configuration used on screen and in PDF exports (ADR 0013): strict security, no
/// HTML labels (labels stay SVG text, so the SVG survives DOMPurify and prints as vectors), dagre
/// layout instead of the 670 KB ELK default, and the app palette for the given theme. Diagrams can
/// pick another `layout`/`look` in front-matter, never the keys in `secure`.
export function mermaidConfig(theme: DiagramTheme): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    secure: SECURE_KEYS,
    htmlLabels: false,
    suppressErrorRendering: true,
    layout: 'dagre',
    look: 'classic',
    theme: 'base',
    themeVariables: THEME_VARIABLES[theme],
    fontFamily: FONT_FAMILY,
    maxTextSize: 50_000,
    maxEdges: 500,
    flowchart: { htmlLabels: false },
  };
}
