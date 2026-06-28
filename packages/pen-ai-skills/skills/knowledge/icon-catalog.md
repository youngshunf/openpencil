---
name: icon-catalog
description: Icon usage rules and available icon names
phase: [generation]
trigger: null
priority: 20
budget: 1000
category: base
---

ICONS (USE PATH NODES — they always resolve):

- Use "path" nodes, size 16-24px. Name = icon name in PascalCase + "Icon" suffix (e.g. "SearchIcon", "MailIcon", "LockIcon").
- The system auto-resolves the name to verified SVG path data — set d to any placeholder (e.g. "M0 0"); "d" is REPLACED automatically. Do NOT hand-author icon geometry.
- Names resolve against Lucide (1700+ icons) AND Feather AND brand logos. Any common UI icon name works. The marker word ("Icon"/"Logo") is required so real custom geometry isn't mistaken for an icon.
- Line icons resolve to stroke style; solid icons (star, play, brand logos) to fill. Set the color via stroke.fill (line) or fill (solid) — the resolver preserves your color.
- NEVER use emoji as icons (emoji in text is auto-stripped).

BRAND / SOCIAL LOGOS (for social login, share, footer):

- Resolve as path nodes too, filled: "WechatIcon", "QqIcon", "WeiboIcon", "AlipayIcon", "AppleIcon", "GoogleIcon", "GithubIcon", "DingtalkIcon", "TiktokIcon"/"DouyinIcon", "TelegramIcon", "WhatsappIcon", "XIcon"/"TwitterIcon", "FacebookIcon", "InstagramIcon", "LinkedinIcon", "YoutubeIcon", "BilibiliIcon", "XiaohongshuIcon".
- Use the brand's own color as fill (WeChat #07C160, QQ #12B7F5, Google #EA4335, Apple #000000), or a neutral icon color inside a bordered circular button.

ICON_FONT NODES (avoid — prefer path nodes):

- icon_font (lucide font glyphs) does NOT auto-resolve in headless/file generation. PREFER path nodes (above) everywhere so the design renders correctly without the editor.
- Icon-only buttons: frame(w=44, h=44, layout="horizontal", alignItems="center", justifyContent="center") > path icon 20-24px. Do NOT use layout="none" + absolute x/y to position the icon (renders unreliably / misaligns).

COMMON LUCIDE ICON NAMES:
search, bell, user, heart, star, plus, x, check, chevron-right, chevron-left, chevron-down, chevron-up,
settings, home, mail, phone, calendar, clock, map-pin, link, external-link,
eye, eye-off, lock, unlock, key, shield,
arrow-right, arrow-left, arrow-up, arrow-down, arrow-up-right,
menu, more-horizontal, more-vertical, filter, sliders,
image, camera, video, file, folder, download, upload, share, copy, trash,
edit, pen-tool, type, bold, italic, underline, align-left, align-center, align-right,
grid, list, layout, columns, maximize, minimize,
sun, moon, cloud, zap, activity, trending-up, trending-down, bar-chart, pie-chart,
users, user-plus, user-check, message-circle, message-square, send,
shopping-cart, shopping-bag, credit-card, dollar-sign, gift, tag, bookmark,
play, pause, skip-forward, skip-back, volume-2, mic,
github, twitter, instagram, facebook, linkedin, youtube,
globe, wifi, bluetooth, monitor, smartphone, tablet, cpu, database, server, hard-drive,
code, terminal, git-branch, git-commit, git-pull-request,
alert-circle, alert-triangle, info, help-circle, check-circle, x-circle
