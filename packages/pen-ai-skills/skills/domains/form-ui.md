---
name: form-ui
description: Form, input, and interactive element design guidelines
phase: [generation]
trigger:
  keywords: [
      # English: form-specific
      form,
      contact form,
      feedback form,
      registration form,
      # English: auth flows
      login,
      log in,
      signin,
      sign in,
      signup,
      sign up,
      register,
      registration,
      password,
      # English: e-commerce
      checkout,
      # English: search & input components — multi-word so word-boundary
      # matching doesn't false-trigger on "research" / "input slider" etc.
      search bar,
      search input,
      search field,
      input field,
      text field,
      text input,
      # Chinese: form / auth
      表单,
      登录,
      注册,
      密码,
      # Chinese: search & input components (substring matching path)
      搜索,
      搜索框,
      输入框,
    ]
priority: 30
budget: 1500
category: domain
---

DESIGN GUIDELINES:

- Mobile: 375x812. Web: 1200x800 (single) or 1200x3000-5000 (landing page).
- "mobile"/"移动端" + screen type = ACTUAL 375x812 screen, NOT desktop with phone mockup.
- Buttons: height 44-52px, cornerRadius 8-12, padding [12, 24]. Icon+text: layout="horizontal", gap=8.
- Icon-only buttons: 44x44, justifyContent/alignItems="center", path icon 20-24px.
- Inputs: height 44px, light bg, subtle border, width="fill_container" in forms.
- Cards: cornerRadius 12-16, clipContent: true, subtle shadows.
- CARD ROW ALIGNMENT: sibling cards in horizontal layout ALL use width/height="fill_container".
- Navigation: justifyContent="space_between", 3 groups (logo | links | CTA), padding=[0,80].
- Phone mockup: ONE "frame", width 260-300, height 520-580, cornerRadius 32. NEVER ellipse.
- NEVER use ellipse for decorative shapes. Use frame/rectangle with cornerRadius.
- NEVER use emoji as icons. Use path nodes with icon names (auto-resolve — see icon-catalog).

INPUT WITH LEADING ICON (the standard login email/password field — do it this way to avoid misalignment):

- The input IS a horizontal layout frame, NOT a rectangle with absolutely-positioned children.
  input = frame(width="fill_container", height=48, cornerRadius=10, fill:[#F8FAFC], stroke:{thickness:1, fill:[#E2E8F0]},
                layout="horizontal", alignItems="center", gap=10, padding:[0,14])
    ├── path(name="MailIcon", width=20, height=20)        // leading icon — vertically centered by alignItems
    └── text(content="邮箱地址", fontSize=15, fill:[#94A3B8])  // placeholder; fill it like remaining space
- Password field: same shape, leading "LockIcon", optionally a trailing "EyeIcon" (add justifyContent="space_between" or a fill_container text between the two icons).
- NEVER position the icon with layout="none" + x/y — that is the #1 cause of "icon overlaps text / sits in the wrong place". Always let alignItems="center" do the vertical centering.

SOCIAL LOGIN ROW:

- A short "or continue with" divider (horizontal frame: line / text / line), then a row of circular icon buttons.
- Each button: frame(width=48, height=48, cornerRadius=24, stroke:{thickness:1, fill:[#E2E8F0]}, layout="horizontal", alignItems="center", justifyContent="center") > path brand logo (WechatIcon / QqIcon / GoogleIcon / AppleIcon) 22-24px, filled with the brand color.
- 3-4 buttons, gap=16, the row frame justifyContent="center". Verify total width fits (see layout HORIZONTAL ROW WIDTH MATH).
