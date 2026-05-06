# 面向 AI 质量验收的浏览器自动化 Skill 合集

用于 AI Agent 执行自动化质量验收的浏览器自动化 Skill 合集，涵盖视觉走查、DOM 断言、截图采集与 UI 回归检测。

[English](README.md)

---

## Skills

### `visual-diff` — Figma 视觉走查

将 Figma 设计稿与真实开发页面进行智能化视觉走查。

- 从 Figma 导出指定 Node 转为 HTML，作为基准。
- 使用浏览器访问真实开发页面，以指定的元素与 Figma HTML 对齐。
- **智能化**生成 VET（视觉效果树，一个把有语义的元素标成色块的结构），2 个 HTML 的 VET 对齐，产出 2 张原始图 + 2 张 VET 图 + 2 张 DIFF 图。
- 视觉对比生成 N 个问题，每个问题启动独立 Subagent 进行确认与数值量化（间距、字体、颜色等）。
- 确认有问题的，在页面上生成标注截图后汇总反馈。

**Skill 组合：**

- `chrome-cdp`：底层驱动 Chrome 进行自动化。
- `element-screenshot`：支持截取某一个元素的图片，避免全页截图有太多干扰。
- `figma-to-html`：提供一个 Figma 链接，解析出其中的文件和 Node，然后只对这一个 Node 生成一份**几乎 100% 还原**的 HTML 文件。
- `vet-generator`：对 2 个页面（Figma HTML 及开发 HTML）生成 VET 并对齐，截出 6 张图片。
- `vet-investigation`：对 6 张图进行深度分析，找到差异点，产出自然语言的问题描述。
- `visual-issue-clarification`：对一个问题进行页面分析，将其量化为元素、样式，并在页面上加上标注后截图。
- `visual-diff`：顶层路由，驱动其它 Skill 的工作流。

**输入示例：**

使用 Figma 设计稿：
> 设计稿：https://www.figma.com/design/xxx?node-id=123-456  
> 开发页：https://localhost:3000/xxx 对应 `.foo > .bar` 元素

直接使用网页：
> 设计页：https://localhost:3001  
> 开发页：https://localhost:3000/xxx 对应 `.foo > .bar` 元素

如需使用 Figma，提供 `FIGMA_TOKEN`（环境变量、`.env` 文件或对话中直接提供均可）。

设计原理详见 [`figma-to-verify/DESIGN.zh.md`](figma-to-verify/DESIGN.zh.md)。

---

### `visual-verify` — 以浏览器视觉为唯一信源的前端交付验收

**核心理念：前端所有改动的正确性，都由视觉作为唯一信源而非看代码。** 静态代码分析、单元测试、lint 都是辅助手段；只有在浏览器里看到的才是用户真正看到的。`visual-verify` 的目标是让 Agent 在完成任何前端改动后，都能像人工测试一样，用浏览器对着真实页面逐一核对。

当 Agent 完成前端编码任务后，任何涉及视觉相关的改动，都应激活此 Skill，通过打开浏览器页面验证改动正确性。

**结构与渲染**
- 元素是否存在、是否可见、是否被遮挡或溢出
- 尺寸、位置、对齐、间距是否符合预期
- 文字截断、滚动容器、粘性定位等布局边界情况

**交互与状态**
- 点击、填写、跳转等操作是否触发正确的页面变化
- 动态内容（Tab 切换、加载态、展开收起、条件渲染）是否按预期呈现
- 表单校验、禁用态、Loading 等中间状态的验证

**回归与兜底**
- 改动是否引入了意外的视觉变化（像素级 diff 对比基线截图）
- 浏览器 console 是否出现新的报错或警告
- 多次操作后页面状态是否保持一致

**机制**
- 断言以合约（JSON）形式描述，可静态 lint、可复用、可版本化
- 空间布局类问题以**标注截图**作为一等公民证据，不依赖纯文字断言
- 跨任务维护持久化记忆（稳定选择器、时序、已知怪异行为），减少重复探索
- 每次任务产出 `contract.md` 验收记录，包含截图路径、断言结果和最终结论

完整用法见 [`visual-verify/SKILL.md`](visual-verify/SKILL.md)。

---

## Skill 组合关系

```
visual-diff
└── figma-to-html / chrome-cdp / element-screenshot / vet-generator / vet-investigation / visual-issue-clarification

visual-verify
└── chrome-cdp + scripts/（DOM断言、截图、标注、对比等工具集）
```
