# Changelog

本插件的所有重要变更都记在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-04-15

首个版本。

### Added

- 通过 `ctx.systemPrompt.section()` 注入一段系统级提示词段落（`ask-first.policy`，order 650）。
- 澄清优先的行为约定：正式给方案之前先提问，每次只问一个问题，用 `ask_user_question` 给出带取舍的选项。
- 停止条件：把握达到 `confidence`（默认 95%）即停止追问并交付完整方案；追问上限 `maxQuestions`（默认 6），到顶后改为写出假设。
- 豁免规则：闲聊寒暄、单纯事实问答、指令已明确、用户要求直接做、紧急排障都不触发追问。
- 配置项 `enabled` / `confidence` / `maxQuestions` / `exemptSmallTalk` / `prompt` / `extraRules`，由 DSH 插件设置面板自动渲染。
- 支持 `{{confidence}}` 与 `{{maxQuestions}}` 占位符，以及用 `prompt` 整体替换内置提示词。
- Host 半侧的冒烟测试（`tools/tests/host-smoke.mjs`），覆盖注册参数、配置插值、边界 clamp 与降级路径。

[0.1.0]: https://github.com/Heidashuai-X/dsh-ask-first/releases/tag/v0.1.0
