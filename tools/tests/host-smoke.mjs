/**
 * Host-half smoke test for dsh-ask-first.
 *
 * The plugin has exactly one observable effect — the arguments it hands to
 * `ctx.systemPrompt.section()` — so this drives `apply()` against a recording
 * fake ctx and asserts on what was registered. No DSH process is needed.
 *
 * Run: node tools/tests/host-smoke.mjs
 */

import assert from 'node:assert/strict'
import { Config, apply, inject, name } from '../../lib/index.js'

/** A fake Host context that records every prompt registration. */
function makeCtx() {
	const sections = []
	const effects = []
	const warnings = []
	return {
		sections,
		effects,
		warnings,
		ctx: {
			systemPrompt: {
				section(section) {
					sections.push(section)
					return () => {}
				},
			},
			effect(fn, label) {
				effects.push(label)
				return fn()
			},
			logger: {
				warn(line) {
					warnings.push(line)
				},
			},
		},
	}
}

const checks = []
function check(title, fn) {
	try {
		fn()
		checks.push({ title, ok: true })
	} catch (error) {
		checks.push({ title, ok: false, detail: String((error && error.message) || error) })
	}
}

// --- module surface --------------------------------------------------------

check('exports the plugin name and declares the systemPrompt dependency', () => {
	assert.equal(name, 'ask-first')
	assert.deepEqual(inject, ['systemPrompt'])
})

check('exposes a Config face when a schema library is available', () => {
	// Config is undefined only on a host without schemastery, which is allowed.
	// A schemastery Schema is callable, so both shapes are accepted here.
	if (Config === undefined) return
	assert.ok(typeof Config === 'function' || typeof Config === 'object')
})

// --- default behavior ------------------------------------------------------

check('registers exactly one section through ctx.effect', () => {
	const h = makeCtx()
	apply(h.ctx, {})
	assert.equal(h.sections.length, 1)
	assert.deepEqual(h.effects, ['ask-first.section()'])
})

check('section carries the namespaced name and a finite order', () => {
	const h = makeCtx()
	apply(h.ctx, {})
	const [section] = h.sections
	assert.equal(section.name, 'ask-first.policy')
	assert.equal(typeof section.order, 'number')
	assert.ok(Number.isFinite(section.order))
})

check('prompt keeps the one-question-per-turn rule', () => {
	const h = makeCtx()
	apply(h.ctx, {})
	const { text } = h.sections[0]
	assert.match(text, /一次只问一个问题/)
	assert.match(text, /ask_user_question/)
})

check('defaults are interpolated and no placeholder survives', () => {
	const h = makeCtx()
	apply(h.ctx, {})
	const { text } = h.sections[0]
	assert.match(text, /\*\*95%\*\*/)
	assert.match(text, /\*\*6 个\*\*/)
	assert.ok(!text.includes('{{'), 'a {{placeholder}} was left unreplaced')
})

// --- configuration ---------------------------------------------------------

check('enabled: false registers nothing at all', () => {
	const h = makeCtx()
	apply(h.ctx, { enabled: false })
	assert.equal(h.sections.length, 0)
	assert.equal(h.effects.length, 0)
})

check('custom confidence and maxQuestions reach the text', () => {
	const h = makeCtx()
	apply(h.ctx, { confidence: 80, maxQuestions: 3 })
	const { text } = h.sections[0]
	assert.match(text, /\*\*80%\*\*/)
	assert.match(text, /\*\*3 个\*\*/)
	assert.ok(!text.includes('{{'))
})

check('out-of-range numbers are clamped instead of throwing', () => {
	const h = makeCtx()
	apply(h.ctx, { confidence: 999, maxQuestions: -4 })
	const { text } = h.sections[0]
	assert.match(text, /\*\*100%\*\*/)
	assert.match(text, /\*\*0 个\*\*/)
})

check('disable the small-talk exemption appends the override note', () => {
	const h = makeCtx()
	apply(h.ctx, { exemptSmallTalk: false })
	assert.match(h.sections[0].text, /豁免条款已由配置关闭/)
})

check('extraRules are appended under their own heading', () => {
	const h = makeCtx()
	apply(h.ctx, { extraRules: '回答一律用中文。' })
	const { text } = h.sections[0]
	assert.match(text, /## 附加规则（来自本插件配置）/)
	assert.ok(text.includes('回答一律用中文。'))
})

check('a custom prompt replaces the shipped template', () => {
	const h = makeCtx()
	apply(h.ctx, { prompt: '先问三个问题。{{confidence}}' })
	const { text } = h.sections[0]
	assert.equal(text, '先问三个问题。95')
})

// --- degraded hosts --------------------------------------------------------

check('a host without systemPrompt warns instead of throwing', () => {
	const h = makeCtx()
	apply({ logger: h.ctx.logger }, {})
	assert.equal(h.sections.length, 0)
	assert.equal(h.warnings.length, 1)
	assert.match(h.warnings[0], /\[dsh-ask-first\]/)
})

check('a host without ctx.effect still registers the section', () => {
	const h = makeCtx()
	apply({ systemPrompt: h.ctx.systemPrompt, logger: h.ctx.logger }, {})
	assert.equal(h.sections.length, 1)
})

// --- report ----------------------------------------------------------------

const failed = checks.filter((entry) => !entry.ok)
for (const entry of checks) {
	console.log((entry.ok ? '  ok   ' : '  FAIL ') + entry.title)
	if (!entry.ok) console.log('         ' + entry.detail)
}
console.log('\n' + (checks.length - failed.length) + '/' + checks.length + ' checks passed')
process.exit(failed.length === 0 ? 0 : 1)
