/**
 * @file request-timeout.ts
 * @description 前端请求超时上限。
 *
 * 服务端调用模型的上限由 AI_TIMEOUT_MS 决定（默认 120 秒），前端超时必须比它更长，
 * 否则服务端还在生成、浏览器已经放弃：用户只会反复看到「请求超时」，而真正的原因
 * 是两边上限不一致。实测一条 1500 字通知做深度解读需要 40–55 秒，贴近边界的 45 秒
 * 会时灵时不灵。
 */
export const AI_REQUEST_TIMEOUT_MS = 300_000;

/** 取配置、抓文章这类不走长文本生成的请求，保持较短的等待。 */
export const SHORT_REQUEST_TIMEOUT_MS = 45_000;
