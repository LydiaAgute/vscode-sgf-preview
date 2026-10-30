// VS Code 在 webview 页面里注入的全局函数，每个页面只能调用一次

interface VsCodeWebviewApi<State> {
  postMessage(message: unknown): void;
  getState(): State | undefined;
  setState(state: State): void;
}

declare function acquireVsCodeApi<State = unknown>(): VsCodeWebviewApi<State>;
