import * as vscode from "vscode";

// stole this from https://stackoverflow.com/a/78415993
export function showNotification(message: string, duration: number) {
	vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification },
		async (progress) => {
			const steps = 100;
			const delay = duration / steps;

			for (let i = 0; i <= steps; i++) {
				await new Promise<void>((resolve) => {
					setTimeout(() => {
						progress.report({ increment: 1, message: message });
						resolve();
					}, delay);
				});
			}
		},
	);
}

const ID = "typeskip";
const DEFAULT_OPACITY = 0.2;

const SUPPORTED_LANGUAGE_IDS = ["typescript", "typescriptreact"];
function isSupportedEditor(editor: vscode.TextEditor) {
	if (!SUPPORTED_LANGUAGE_IDS.includes(editor.document.languageId))
		return false;
	return true;
}

type Scope = "workspace" | "global";

async function activate(context: vscode.ExtensionContext) {
	const { default: tsBlankSpace } = await import("ts-blank-space");

	// state
	// -----

	vscode.commands.executeCommand("setContext", `${ID}.activated`, true);

	const state = {
		workspace: context.workspaceState.get<boolean>(`${ID}.enabled`, false),
		global: context.globalState.get<boolean>(`${ID}.enabled`, false),
	};

	function setState(scope: Scope, enabled: boolean) {
		if (state[scope] === enabled) return;
		state[scope] = enabled;

		const persistentState = context[`${scope}State`];
		persistentState.update(`${ID}.enabled`, enabled);

		vscode.commands.executeCommand(
			"setContext",
			`${ID}.${scope}Enabled`,
			enabled,
		);

		const msgAction = enabled ? "now hidden" : "no longer hidden";
		const msgContext = scope === "global" ? "globally" : "for this workspace";
		const msg = `TypeScript types are ${msgAction} ${msgContext}.`;
		showNotification(msg, 5000);

		update();
	}

	// configuration
	// -------------

	const configuration = vscode.workspace.getConfiguration(ID);
	let opacity = configuration.get<number>("opacity", DEFAULT_OPACITY);
	let decorationType = createDecorationType(opacity);
	vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration(`${ID}.opacity`)) {
			const newOpacity = vscode.workspace
				.getConfiguration(ID)
				.get<number>("opacity", DEFAULT_OPACITY);
			if (newOpacity !== opacity) {
				opacity = newOpacity;
				decorationType.dispose();
				decorationType = createDecorationType(opacity);
				update();
			}
		}
	});

	// decorations
	// -----------

	function createDecorationType(
		opacity: number,
	): vscode.TextEditorDecorationType {
		return vscode.window.createTextEditorDecorationType({
			opacity: opacity.toString(),
		});
	}

	function applyDecorations() {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !isSupportedEditor(editor)) return;

		const originalContent: string = editor.document.getText();
		const blankedContent: string = tsBlankSpace(originalContent);

		const rangesToDim: vscode.Range[] = [];

		for (let j = 0; j < originalContent.length; j++) {
			if (originalContent[j] !== blankedContent[j]) {
				const start = j;

				while (
					j < originalContent.length &&
					originalContent[j] !== blankedContent[j]
				) {
					j++;
				}

				const range = new vscode.Range(
					editor.document.positionAt(start),
					editor.document.positionAt(j),
				);
				rangesToDim.push(range);
			}
		}

		editor.setDecorations(decorationType, rangesToDim);
	}

	function clearDecorations() {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;
		editor.setDecorations(decorationType, []);
	}

	function updateDecorations() {
		if (state.workspace || state.global) {
			applyDecorations();
		} else {
			clearDecorations();
		}
	}

	// status bar
	// ----------

	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);
	statusBarItem.command = `${ID}.workspaceToggle`;
	context.subscriptions.push(statusBarItem);

	function updateStatusBar() {
		const editor = vscode.window.activeTextEditor;
		if (!editor || !isSupportedEditor(editor)) return statusBarItem.hide();

		const hidden = state.workspace || state.global;
		const cause = hidden
			? state.workspace
				? "workspace"
				: "global"
			: undefined;
		statusBarItem.text = hidden
			? `$(eye-closed) Types hidden (${cause})`
			: "Hide types";
		const tooltip = new vscode.MarkdownString(
			`

|     |      |     |      |
| --- | ---: | --- | ---: |
| [$(triangle-up) Increase opacity](command:${ID}.increaseOpacity)⠀⠀⠀ | Workspace: | ⠀${state.workspace ? "$(eye-closed) hidden" : "$(eye) visible"} | - [toggle](command:${ID}.workspaceToggle) |
| [$(triangle-down) Decrease opacity](command:${ID}.decreaseOpacity)                  | Global:    | ⠀${state.global ? "$(eye-closed) hidden" : "$(eye) visible"}    | - [toggle](command:${ID}.globalToggle)    |

---

Click to hide/show TypeScript types in this workspace.

`.trim(),
		);
		tooltip.isTrusted = true;
		tooltip.supportThemeIcons = true;
		statusBarItem.tooltip = tooltip;

		statusBarItem.backgroundColor = hidden
			? new vscode.ThemeColor("statusBarItem.warningBackground")
			: undefined;
		statusBarItem.show();
	}

	// commands
	// --------

	function register(
		command: string,
		scope: Scope,
		enabled: boolean | (() => boolean),
	) {
		vscode.commands.registerCommand(`${ID}.${command}`, () => {
			const resolvedEnabled =
				typeof enabled === "function" ? enabled() : enabled;
			setState(scope, resolvedEnabled);
		});
	}

	register("workspaceEnable", "workspace", true);
	register("workspaceDisable", "workspace", false);
	register("workspaceToggle", "workspace", () => !state.workspace);
	register("globalEnable", "global", true);
	register("globalDisable", "global", false);
	register("globalToggle", "global", () => !state.global);

	vscode.commands.registerCommand(`${ID}.increaseOpacity`, () => {
		const newOpacity = Math.min(opacity + 0.1, 1);
		opacity = newOpacity;
		decorationType.dispose();
		decorationType = createDecorationType(opacity);
		update();
	});

	vscode.commands.registerCommand(`${ID}.decreaseOpacity`, () => {
		const newOpacity = Math.max(opacity - 0.1, 0);
		opacity = newOpacity;
		decorationType.dispose();
		decorationType = createDecorationType(opacity);
		update();
	});

	// updates
	// -------

	function update() {
		updateDecorations();
		updateStatusBar();
	}

	vscode.workspace.onDidChangeTextDocument(update);
	vscode.workspace.onDidOpenTextDocument(update);
	vscode.window.onDidChangeActiveTextEditor(update);
}

function deactivate(): void {}

export { activate, deactivate };
