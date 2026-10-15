# dsh-ask-first

> 正式回答之前，先向你提问——每次只问一个问题，追问到有足够把握理解你的真实需求与最终目标，再给出完整方案。

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件。

```text
你：帮我优化一下这个脚本。
DSH：在动手之前我想先确认一个问题——你说的「优化」更偏向哪一边？
      · 跑得更快（推荐，通常收益最大）—— 不改行为，只改实现
      · 更好读 —— 拆函数、加注释，性能不变
      · 更稳 —— 补错误处理与边界，可能变慢一点
     （这个答案决定了我是重写核心循环，还是只做整理。）
你：跑得更快。
DSH：【给出完整方案】
```

## 它做什么

给 DSH 注入一段**系统级提示词**，约束模型在给方案之前先做需求澄清：

| 情形 | 行为 |
| --- | --- |
| 目标模糊、存在取舍、交付物形态不明、缺关键约束 | **先提问**，一次一个问题 |
| 即将执行不可逆操作（删除 / 覆盖 / 发布 / 对外发送 / 花钱） | **先提问** |
| 闲聊寒暄、发表情、玩笑 | **不提问**，正常聊 |
| 单纯的事实问答（查资料 / 算数 / 翻译 / 解释概念） | **不提问**，直接答 |
| 指令已明确、无歧义 | **不提问**，直接做 |
| 用户说「别问了，直接做」或紧急排障 | **不提问**，先止血 |

提问时它被要求：一次只问 **一个问题**、用 `ask_user_question` 工具、给出 2–4 个**带取舍说明**的具体选项、把推荐项放第一个，并说明这个答案会改变方案的哪一部分。

当模型能用一句话复述「用户真正要什么、最终交付什么、什么算做完」且把握达到阈值（默认 **95%**）时，停止提问、直接交付。追问次数有上限（默认 **6 个**），到顶后改为在方案开头写出它替你做的假设，而不是无限追问。

## 安装

需要一个可用的 DSH（`dsh` CLI 在 DSH 安装目录的 `resources/runtime/cli/bin/` 下）。

```bash
# 方式一：从 GitHub 直装（pnpm 的 github: 协议）
dsh plugin --profile desktop add github:Heidashuai-X/dsh-ask-first

# 方式二：从本地检出安装（改代码即时生效，适合二次开发）
git clone https://github.com/Heidashuai-X/dsh-ask-first.git
dsh plugin --profile desktop add link:/absolute/path/to/dsh-ask-first
```

把 `desktop` 换成你自己的 profile 名（见 `DSH_PROFILE` 环境变量）。

装好后**重启 DSH**，或在该 profile 里重新加载插件。想确认它活着：设置 → 插件，列表里应出现 `dsh-ask-first`，点开就是下面的配置表单。

## 配置

不需要改代码，在 DSH 的插件设置面板里直接填（这个插件声明了 Config schema，DSH 会自动渲染成表单）：

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关。关掉后不再注入任何提示词段落。 |
| `confidence` | `95` | 停止追问的把握阈值（1–100）。越大越谨慎、问得越多。 |
| `maxQuestions` | `6` | 追问次数上限（0–50）。到顶后改为写假设，而不是继续追问。 |
| `exemptSmallTalk` | `true` | 闲聊与单纯事实问答的豁免。关掉后「无论多像闲聊，只要含任务就先问」。 |
| `prompt` | 空 | 完全替换内置提示词。留空则用 [`prompts/ask-first.md`](prompts/ask-first.md)。 |
| `extraRules` | 空 | 追加到提示词末尾的自定义规则，用来补自己的豁免或约束。 |

提示词里支持两个占位符：`{{confidence}}` 与 `{{maxQuestions}}`，会在注册前被替换成当前配置值。

想改成英文、或者只想要你自己那版规则，把 `prompt` 填满即可，整个内置文本都会被替换。

## 想改内置提示词

直接编辑 [`prompts/ask-first.md`](prompts/ask-first.md)——插件启动时读取这个文件，改了重启即生效。这是这个插件的全部「策略」，读它就等于读这个插件的大脑。

## 实现

一共一个文件、约 200 行：[`lib/index.js`](lib/index.js)。

它只用 DSH 的两个 Host 能力：

```js
export const name = 'ask-first'
export const inject = ['systemPrompt']      // 声明依赖，Cordis 会保证顺序

export function apply(ctx, config) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'ask-first.policy',   // 命名空间化的段落名，避免与他人重名冲突
    order: 650,                 // 落在 PLAN_POLICY(500) 与 PTC_ONLY(800) 之间的策略区
    text,                       // 渲染后的提示词
  }), 'ask-first.section()')
}
```

几点刻意的选择：

- **不 import 任何 `@deepseek-ai/*` 包。** 从 GitHub 或 `link:` 安装时，检出目录里没有自己的 `node_modules`，硬 import 会解析失败。schema 库改为在运行时从 DSH home 动态查找；找不到就退化成「没有配置表单」，插件照常工作而不是加载失败。
- **`ctx.effect` 包裹注册。** 插件被禁用或热重载时，Cordis 会自动摘掉这个段落，不会在系统提示词里留下幽灵副本。
- **段落名带命名空间。** 同一作用域层里重名会直接抛错，可能拖垮整个插件加载。
- **越界数字一律 clamp。** 手改配置文件也炸不了。

副作用范围：**不联网、不写文件、不注册任何工具、不改任何会话数据**，只是往系统提示词里插一段文本。

## 开发与测试

```bash
node tools/tests/host-smoke.mjs     # 或 npm test
```

测试用一个记录型的假 `ctx` 驱动 `apply()`，断言注册出去的段落名、order、以及渲染后的文本（含配置插值、clamp、豁免开关、自定义替换、以及缺 `systemPrompt` / 缺 `ctx.effect` 的降级路径）。不需要起 DSH 进程。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-ask-first
```

## License

[MIT](LICENSE)
