/**
 * dsh-ask-first — Host half.
 *
 * Registers exactly one system-prompt section telling the agent to interview the
 * user before it proposes anything: one question per turn, until it is confident
 * enough about the real goal, then a complete plan.
 *
 * Only two Host surfaces are used:
 *   ctx.systemPrompt.section({ name, order, text })
 * and, when it exists, ctx.effect() so Cordis disposes the registration with the
 * plugin fiber.
 *
 * This package deliberately imports nothing from `@deepseek-ai/*`: a GitHub or
 * `link:` install reaches this file from a checkout without its own
 * node_modules, so a hard import would fail to resolve. The schema library is
 * looked up from the DSH home instead, and a missing one degrades to "no Config
 * form" rather than a load failure.
 *
 * @module dsh-ask-first
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Cordis plugin name. */
export const name = 'ask-first'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/**
 * Section identity. The name is namespaced because a duplicate within one scope
 * layer throws — the whole plugin would fail to load, not just this row.
 */
const SECTION_NAME = 'ask-first.policy'

/**
 * Placement inside the assembled system prompt.
 *
 * The registry's own orders run HARNESS_IDENTITY (-1000), DEPLOYMENT_PERSONA_
 * PREFIX (0), PLAN_POLICY (500), TEAM_POLICY (600), PTC_ONLY (800), then the
 * per-tool blocks from 1000 up. This is a policy, so it belongs in that policy
 * lane: after plan and team policy, before the tool manuals, and far from every
 * value the registry actually uses so a future row cannot collide with it.
 */
const SECTION_ORDER = 650

/** Shipped template, read from next to this file. */
const PROMPT_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts', 'ask-first.md')

/** Last-resort text, used only when the shipped template cannot be read. */
const FALLBACK_TEMPLATE = [
	'# 先提问，再给方案（Ask First）',
	'',
	'在给出正式方案之前，先弄清用户的真实需求与最终目标；把握不足时，先问，不要先猜。',
	'',
	'- 必须先提问：目标模糊、存在取舍、交付物形态不明、缺关键约束、即将执行不可逆操作。',
	'- 不要提问（豁免）：闲聊寒暄、单纯的事实问答、指令已明确无歧义、用户要求直接做、紧急排障。',
	'- 一次只问一个问题，用 `ask_user_question` 工具并给出 2–4 个带取舍说明的选项。',
	'- 当把握达到 {{confidence}}% 时停止提问；最多问 {{maxQuestions}} 个问题，之后改为写出你替用户做的假设。',
].join('\n')

/** Behavior defaults; also the seed for a first run. */
const DEFAULTS = {
	enabled: true,
	confidence: 95,
	maxQuestions: 6,
	exemptSmallTalk: true,
}

/**
 * Bases the host schema library is looked up from. Schemastery is a host package
 * this bundle does not depend on, so a plain ancestor walk is not enough: a
 * `link:` install reaches this file through a junction into a source checkout
 * that carries no node_modules of its own.
 *
 * @returns candidate require bases, most specific first.
 */
function schemaLookupBases() {
	const bases = [import.meta.url]
	const home = process.env.DSH_HOME || join(homedir(), '.dsh')
	bases.push(pathToFileURL(join(home, 'profiles', 'package.json')).href)
	if (process.env.DSH_PROFILE_DIR) {
		bases.push(pathToFileURL(join(process.env.DSH_PROFILE_DIR, 'package.json')).href)
	}
	try {
		bases.push(pathToFileURL(join(process.cwd(), 'package.json')).href)
	} catch { /* cwd unavailable */ }
	return bases
}

/** The host schema library, or null when this runtime cannot supply one. */
const schema = (() => {
	for (const base of schemaLookupBases()) {
		try {
			const mod = createRequire(base)('@deepseek-ai/schemastery')
			const candidate = (mod && mod.default) || mod
			if (candidate && typeof candidate.object === 'function') return candidate
		} catch { /* try the next base */ }
	}
	return null
})()

/**
 * Plugin config face. Every key is optional, so an install that never opens the
 * settings page still gets the documented behavior.
 */
export const Config = schema
	? schema.object({
		enabled: schema.boolean().default(DEFAULTS.enabled)
			.description('总开关：关闭后不再注入任何提示词段落。'),
		confidence: schema.number().default(DEFAULTS.confidence)
			.description('停止追问的把握阈值（1–100）。越大越谨慎、问得越多。'),
		maxQuestions: schema.number().default(DEFAULTS.maxQuestions)
			.description('追问次数上限（0–50）。到顶后改为写出假设，而不是继续追问。'),
		exemptSmallTalk: schema.boolean().default(DEFAULTS.exemptSmallTalk)
			.description('闲聊/小事豁免：开着时，寒暄与单纯的事实问答不会被追问。'),
		prompt: schema.string().default('')
			.description('完全替换内置提示词（留空则使用插件自带的 prompts/ask-first.md）。'),
		extraRules: schema.string().default('')
			.description('追加到提示词末尾的自定义规则，用于补充你自己的豁免或约束。'),
	})
	: undefined

/** Clamp a possibly non-numeric option into a usable integer range. */
function clampInt(value, low, high, fallback) {
	const n = Number(value)
	if (!Number.isFinite(n)) return fallback
	return Math.min(high, Math.max(low, Math.round(n)))
}

/**
 * Validate and normalize a configuration coming from the settings form.
 * Anything unknown is dropped and every number is clamped, so a hand-edited
 * config file can never produce a broken prompt.
 *
 * @param config - candidate plugin config.
 * @returns a complete, bounded config object.
 */
function resolveConfig(config) {
	const source = config && typeof config === 'object' ? config : {}
	return {
		enabled: source.enabled !== false,
		confidence: clampInt(source.confidence, 1, 100, DEFAULTS.confidence),
		maxQuestions: clampInt(source.maxQuestions, 0, 50, DEFAULTS.maxQuestions),
		exemptSmallTalk: source.exemptSmallTalk !== false,
		prompt: typeof source.prompt === 'string' ? source.prompt.trim() : '',
		extraRules: typeof source.extraRules === 'string' ? source.extraRules.trim() : '',
	}
}

/** The shipped template, read once and kept. */
let templateCache = null
function shippedTemplate() {
	if (templateCache !== null) return templateCache
	try {
		templateCache = readFileSync(PROMPT_FILE, 'utf8')
	} catch {
		templateCache = FALLBACK_TEMPLATE
	}
	return templateCache
}

/**
 * Substitute `{{name}}` placeholders.
 *
 * Split/join rather than `String.replace`: a replacement string treats `$&` and
 * friends specially, and the values here can be user text.
 */
function fill(template, values) {
	let out = String(template)
	for (const [key, value] of Object.entries(values)) {
		out = out.split('{{' + key + '}}').join(String(value))
	}
	return out
}

/**
 * Build the exact text registered as the prompt section.
 *
 * @param config - the resolved config.
 * @returns the rendered prompt text.
 */
function renderPrompt(config) {
	const base = config.prompt !== '' ? config.prompt : shippedTemplate()
	const blocks = [fill(base, { confidence: config.confidence, maxQuestions: config.maxQuestions })]
	if (!config.exemptSmallTalk) {
		blocks.push([
			'## 六、豁免条款已由配置关闭',
			'',
			'上文「直接干活、不要提问」的豁免不再适用：无论输入多短、多像闲聊，只要其中含有待完成的任务，就先提问确认。',
		].join('\n'))
	}
	if (config.extraRules !== '') {
		blocks.push(['## 附加规则（来自本插件配置）', '', config.extraRules].join('\n'))
	}
	return blocks.join('\n\n')
}

/**
 * Report a non-fatal problem where the Host can actually see it.
 *
 * A plugin that silently registers nothing looks healthy from the outside —
 * the agent simply never asks. That is exactly the failure this makes visible.
 *
 * @param ctx - Host root context; its logger is preferred when it has one.
 * @param message - one line, no trailing newline.
 */
function warn(ctx, message) {
	const line = '[dsh-ask-first] ' + message
	const logger = ctx && ctx.logger
	if (logger && typeof logger.warn === 'function') {
		try { logger.warn(line); return } catch { /* fall back to the console */ }
	}
	try { console.warn(line) } catch { /* no console available */ }
}

/**
 * Register the prompt section for the mounting context's scope.
 *
 * @param ctx - Host root context.
 * @param config - raw plugin configuration.
 */
export function apply(ctx, config) {
	const resolved = resolveConfig(config)
	if (!resolved.enabled) return

	const systemPrompt = ctx && ctx.systemPrompt
	if (!systemPrompt || typeof systemPrompt.section !== 'function') {
		warn(ctx, '当前 Host 没有可用的 systemPrompt 服务，未注册提示词段落（需要 DSH >= 0.1.5-rc.1）。')
		return
	}

	const text = renderPrompt(resolved)
	const register = () => systemPrompt.section({
		name: SECTION_NAME,
		order: SECTION_ORDER,
		text,
	})

	// ctx.effect ties the registration to the plugin fiber, so a reload or a
	// disable disposes it. Older hosts without it still get the section, they
	// just keep it until the process restarts.
	if (typeof ctx.effect === 'function') {
		ctx.effect(register, 'ask-first.section()')
		return
	}
	try {
		register()
	} catch (error) {
		warn(ctx, '注册提示词段落失败：' + String((error && error.message) || error).slice(0, 200))
	}
}
