'use strict';
// Nkana — registers one language-model tool per skill, and the command that
// (re)builds the tool list.
//
// The interesting part is `renderSkill`. A skill only takes effect if the model
// treats what it receives as INSTRUCTIONS rather than as reference material, so
// the returned text is framed the way VS Code frames its own skills — with an
// explicit directive, the skill's own applicability note, and a listing of the
// skill folder so the model knows what else it may read.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { apply } = require('./generate');

/** Folders never worth offering as skill resources. */
const IGNORED_DIRS = new Set([
	'node_modules', '.git', '.github', '__pycache__', 'coverage',
	'target', 'bin', 'obj', '.venv', 'venv', 'dist', 'build',
]);

const MAX_LISTED_FILES = 40;
const MAX_DEPTH = 3;

/**
 * List the files that sit beside a SKILL.md, relative to the skill folder.
 * Only names are returned — the model reads one only when the instructions ask
 * for it. This is the progressive-disclosure half of a skill.
 * @param {string} skillFile absolute path to the SKILL.md
 * @returns {string[]} relative paths, sorted
 */
function listRelatedFiles(skillFile) {
	const root = path.dirname(skillFile);
	const found = [];

	/** @param {string} dir @param {number} depth */
	const walk = (dir, depth) => {
		if (depth > MAX_DEPTH || found.length >= MAX_LISTED_FILES) {
			return;
		}
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (found.length >= MAX_LISTED_FILES || entry.name.startsWith('.')) {
				continue;
			}
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!IGNORED_DIRS.has(entry.name)) {
					walk(full, depth + 1);
				}
			} else if (entry.name !== 'SKILL.md') {
				found.push(path.relative(root, full));
			}
		}
	};

	walk(root, 0);
	return found.sort();
}

/** Strip the leading `---` frontmatter block from a SKILL.md. */
function readSkillBody(skillFile) {
	const raw = fs.readFileSync(skillFile, 'utf8');
	const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw);
	return (frontmatter ? raw.slice(frontmatter[0].length) : raw).trim();
}

/**
 * Build the text handed back to the model for one attached skill.
 *
 * Shape, and why:
 *  - a `<skill>` tag, matching how VS Code wraps skills and other context;
 *  - an explicit directive first, because a bare markdown body reads as a
 *    document rather than as something to obey;
 *  - the skill's own "when this applies" note, so the model can judge fit;
 *  - the body;
 *  - the folder listing last, so it reads as an index, not as content.
 *
 * @param {{path: string, name: string, description?: string}} skill
 * @returns {string}
 */
function renderSkill(skill) {
	const parts = [
		`<skill name="${skill.name}" path="${skill.path}">`,
		'These are authoritative instructions for this request. Apply them now, before',
		'producing other output about the task. Treat them as directives, not as',
		'reference material, and do not merely summarise them.',
	];

	if (skill.description) {
		parts.push('', `When this skill applies: ${skill.description}`);
	}

	parts.push('', readSkillBody(skill.path));

	const files = listRelatedFiles(skill.path);
	if (files.length) {
		parts.push(
			'',
			"Files in this skill's folder — read one only if the instructions above refer to it:",
			...files.map((file) => `- ${file}`),
		);
	}

	parts.push('</skill>');
	return parts.join('\n');
}

/** Tool id -> skill record. Absent before the first scan, hence the guard. */
function loadSkills(extensionDir) {
	try {
		return JSON.parse(fs.readFileSync(path.join(extensionDir, 'skills.json'), 'utf8'));
	} catch {
		return {};
	}
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	const extensionDir = context.extensionPath;
	const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf8'));
	const tools = manifest.contributes?.languageModelTools ?? [];
	const skills = loadSkills(extensionDir);

	for (const tool of tools) {
		const skill = skills[tool.name];
		if (!skill) {
			continue;
		}
		context.subscriptions.push(
			vscode.lm.registerTool(tool.name, {
				/**
				 * @param {vscode.LanguageModelToolInvocationOptions<object>} _options
				 * @returns {Promise<vscode.LanguageModelToolResult>}
				 */
				async invoke(_options) {
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(renderSkill(skill)),
					]);
				},
			}),
		);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('nkana.generate', async () => {
			let result;
			try {
				result = apply(extensionDir);
			} catch (error) {
				vscode.window.showErrorMessage(`Nkana: could not scan skills — ${error.message}`);
				return;
			}
			const detail = result.skipped.length
				? ` (${result.skipped.length} skipped as duplicates or reserved names)`
				: '';
			const choice = await vscode.window.showInformationMessage(
				`Nkana: ${result.count} skills are now #-referenceable${detail}. Reload to apply.`,
				'Reload Window',
			);
			if (choice === 'Reload Window') {
				vscode.commands.executeCommand('workbench.action.reloadWindow');
			}
		}),
	);

	if (!tools.length) {
		vscode.window
			.showInformationMessage(
				'Nkana: no skills registered yet. Run "Nkana: Scan skills" to build the # list.',
				'Scan skills',
			)
			.then((choice) => {
				if (choice === 'Scan skills') {
					vscode.commands.executeCommand('nkana.generate');
				}
			});
	}
}

function deactivate() {
	// Tools and commands are disposed through context.subscriptions.
}

module.exports = { activate, deactivate };
