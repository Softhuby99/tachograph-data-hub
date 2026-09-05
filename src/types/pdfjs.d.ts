declare module "pdfjs-dist/legacy/build/pdf.min.mjs" {
  export interface TextItemLike {
    str?: string;
  }
  export interface TextContent {
    items: TextItemLike[];
  }
  export interface PdfPage {
    getTextContent(): Promise<TextContent>;
  }
  export interface PdfDocument {
    numPages: number;
    getPage(n: number): Promise<PdfPage>;
    destroy(): Promise<void>;
  }
  export interface LoadingTask {
    promise: Promise<PdfDocument>;
  }
  export const GlobalWorkerOptions: { workerPort: unknown; workerSrc: unknown };
  export function getDocument(options: {
    data: Uint8Array;
    isEvalSupported?: boolean;
    useSystemFonts?: boolean;
    disableFontFace?: boolean;
  }): LoadingTask;
}
