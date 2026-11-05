window.__ModuleLoader__.load({
  id: 'dsh-preset-studio',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useCallback = React.useCallback

    /* ── API (document-relative: the GUI is served with <base href="./">) ── */
    const API = {
      presets: 'api/studio/presets',
      read: 'api/studio/read',
      write: 'api/studio/write',
      create: 'api/studio/entry/create',
      toggle: 'api/studio/entry/toggle',
      toolToggle: 'api/studio/tool/toggle',
      toolAdd: 'api/studio/tool/add',
      wire: 'api/studio/wire',
      presetCreate: 'api/studio/preset/create',
      install: 'api/studio/preset/install',
      uninstall: 'api/studio/preset/uninstall',
    }

    class ApiError extends Error {
      constructor(message, status, body) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.body = body
      }
    }

    async function request(url, options) {
      const init = { method: (options && options.method) || 'GET' }
      if (options && options.body !== undefined) {
        init.headers = { 'content-type': 'application/json' }
        init.body = JSON.stringify(options.body)
      }
      const response = await fetch(url, init)
      const text = await response.text()
      let body = null
      try {
        body = text === '' ? null : JSON.parse(text)
      } catch {
        body = null
      }
      if (!response.ok) {
        const message = body && typeof body.error === 'string' ? body.error : 'HTTP ' + response.status
        throw new ApiError(message, response.status, body)
      }
      return body
    }

    /* ── strings ── */
    const NS = 'studio'
    const DICT = {
      zh: {
        'panel.label': '预设工作室',
        'page.title': '预设工作室',
        'page.empty': '还没有预设',
        'page.emptyHint': '在「预设」目录下新建一个子目录，放进 cordis.patch.yml，就会出现在这里。',
        'label.preset': '预设',
        'action.refresh': '刷新',
        'action.reload': '重新读取',
        'action.save': '保存',
        'action.create': '新建',
        'action.cancel': '取消',
        'action.add': '新建',
        'action.wire': '接上',
        'action.install': '装进 DSH',
        'action.uninstall': '卸载',
        'action.takeDisk': '载入磁盘版本',
        'state.installed': '已装进 DSH',
        'state.installing': '装…',
        'state.removing': '卸…',
        'state.dirty': '未保存',
        'state.saved': '已保存',
        'state.clean': '未修改',
        'state.wired': '已接上',
        'state.nowire': '不需要接线',
        'unit.bytes': 'B',
        'unit.kb': 'KB',
        'unit.lines': '行',
        'unit.chars': '字',
        'unit.items': '条',
        'wire.missing': '桌面文件已就绪，但还没接进 DSH：',
        'confirm.discard': '有未保存的修改，放弃并切换吗？',
        'confirm.uninstall': '把这个预设从 DSH 卸掉？磁盘上的文件不会删，只是它不再出现在预设列表里。',
        'notice.empty': '这个预设还没有这一栏。',
        'notice.pick': '从左边点一条，右边就能改。',
        'notice.toolAuto': '这一行由平台决定，不能在面板里开关。',
        'field.add': '添加工具',
        'field.have': '已有',
      },
      en: {
        'panel.label': 'Preset Studio',
        'page.title': 'Preset Studio',
        'page.empty': 'No presets yet',
        'page.emptyHint': 'Create a subfolder under 预设 with a cordis.patch.yml inside.',
        'label.preset': 'Preset',
        'action.refresh': 'Refresh',
        'action.reload': 'Reload',
        'action.save': 'Save',
        'action.create': 'Create',
        'action.cancel': 'Cancel',
        'action.add': 'New',
        'action.wire': 'Wire',
        'action.install': 'Install into DSH',
        'action.uninstall': 'Uninstall',
        'action.takeDisk': 'Take disk version',
        'state.installed': 'Installed in DSH',
        'state.installing': 'Installing…',
        'state.removing': 'Removing…',
        'state.dirty': 'Unsaved',
        'state.saved': 'Saved',
        'state.clean': 'Unchanged',
        'state.wired': 'Wired',
        'state.nowire': 'No wiring needed',
        'unit.bytes': 'B',
        'unit.kb': 'KB',
        'unit.lines': 'lines',
        'unit.chars': 'chars',
        'unit.items': 'items',
        'wire.missing': 'The files exist, but this is not connected to DSH yet:',
        'confirm.discard': 'Discard unsaved changes and switch?',
        'confirm.uninstall': 'Uninstall this preset from DSH? Files stay on disk.',
        'notice.empty': 'Nothing in this section yet.',
        'notice.pick': 'Pick an entry on the left to edit it here.',
        'notice.toolAuto': 'This row is decided by the platform and cannot be switched here.',
        'field.add': 'Add tool',
        'field.have': 'present',
      },
    }
    let translate = (key) => {
      const dict = DICT.zh
      return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
    }
    const t = (key) => translate(key)

    /* ── theme ── */
    const themeStore = {
      listeners: new Set(),
      value: 'dark',
      get: () => themeStore.value,
      set: (next) => {
        if (themeStore.value === next) return
        themeStore.value = next
        for (const listener of themeStore.listeners) listener()
      },
      subscribe: (listener) => {
        themeStore.listeners.add(listener)
        return () => themeStore.listeners.delete(listener)
      },
    }

    function useMode() {
      const [mode, setMode] = useState(themeStore.get())
      useEffect(() => themeStore.subscribe(() => setMode(themeStore.get())), [])
      return mode
    }

    function palette(mode) {
      if (mode === 'light') {
        return {
          surface: 'rgba(255, 255, 255, 0.62)',
          code: 'rgba(252, 252, 253, 0.94)',
          card: 'rgba(252, 252, 253, 0.92)',
          hairline: 'rgba(0, 0, 0, 0.12)',
          hairlineStrong: 'rgba(0, 0, 0, 0.20)',
          active: 'rgba(0, 0, 0, 0.07)',
          hover: 'rgba(0, 0, 0, 0.04)',
          blur: 'saturate(1.1) blur(18px)',
          text: '#1b1d22',
          textDim: 'rgba(27, 29, 34, 0.62)',
          accent: '#2f63c9',
          warn: '#a86a12',
          error: '#b3261e',
          wireTint: 'rgba(255, 255, 255, 0.55)',
        }
      }
      return {
        surface: 'rgba(255, 255, 255, 0.045)',
        code: 'rgba(10, 12, 16, 0.86)',
        card: 'rgba(14, 16, 21, 0.82)',
        hairline: 'rgba(255, 255, 255, 0.12)',
        hairlineStrong: 'rgba(255, 255, 255, 0.22)',
        active: 'rgba(255, 255, 255, 0.11)',
        hover: 'rgba(255, 255, 255, 0.055)',
        blur: 'saturate(1.15) blur(18px)',
        text: '#e9eaee',
        textDim: 'rgba(233, 234, 238, 0.64)',
        accent: '#4b7bd8',
        warn: '#d9a03c',
        error: '#e06a5f',
        wireTint: 'rgba(0, 0, 0, 0.28)',
      }
    }

    /* ── stylesheet (one <style>, scoped under .dcm) ── */
    const STYLE_ID = 'dcm-style'
    const STYLES = `
.dcm{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.45}
.dcm *{box-sizing:border-box}
.dcm ::selection{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 34%,transparent)}
.dcm-head{display:flex;align-items:center;gap:10px;padding:12px 18px 10px;flex:none}
.dcm-title{margin:0;font-size:15px;font-weight:650;letter-spacing:.2px;white-space:nowrap}
.dcm-sep{width:1px;height:18px;background:var(--cm-hairline);flex:none}
.dcm-grow{flex:1;min-width:0}
.dcm-install{display:flex;align-items:center;gap:6px;flex:none}
.dcm-picks{display:flex;gap:3px;padding:3px;border:1px solid var(--cm-hairline);border-radius:10px;background:var(--cm-surface);overflow-x:auto;scrollbar-width:none;max-width:min(46vw,520px)}
.dcm-picks::-webkit-scrollbar{display:none}
.dcm-pick{border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:3px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s}
.dcm-pick:hover{background:var(--cm-hover);color:var(--dsw-alias-label-primary)}
.dcm-pick[data-on="1"]{background:var(--cm-active);border-color:var(--cm-hairline-strong);color:var(--dsw-alias-label-primary);font-weight:600}
.dcm-body{display:flex;gap:10px;flex:1;min-height:0;padding:0 18px 14px}
.dcm-bar{display:flex;align-items:center;gap:8px;min-height:26px;flex:none}
.dcm-list{flex:0 0 280px;width:280px;display:flex;flex-direction:column;gap:2px;padding:6px;overflow:auto;border:1px solid var(--cm-hairline);border-radius:12px;background:var(--cm-surface);backdrop-filter:var(--cm-blur);-webkit-backdrop-filter:var(--cm-blur)}
.dcm-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:8px}
.dcm-btn{border:1px solid var(--cm-hairline-strong);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:4px 11px;border-radius:8px;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s,opacity .12s,filter .12s}
.dcm-btn:hover:not(:disabled){background:var(--cm-hover);border-color:var(--dsw-alias-brand-primary)}
.dcm-btn:disabled{opacity:.42;cursor:default}
.dcm-btn[data-kind="solid"]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff;font-weight:600}
.dcm-btn[data-kind="solid"]:hover:not(:disabled){filter:brightness(1.09);background:var(--dsw-alias-brand-primary)}
.dcm-btn[data-kind="sm"]{padding:2px 9px;font-size:11.5px}
.dcm-btn[data-kind="ghost"]{border-color:transparent;color:var(--dsw-alias-label-secondary)}
.dcm-btn[data-kind="ghost"]:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--cm-hairline)}
.dcm-gh{display:flex;align-items:center;gap:6px;padding:8px 8px 4px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);cursor:pointer;border:none;background:transparent;font-family:inherit;width:100%;text-align:left}
.dcm-gh:hover{color:var(--dsw-alias-label-secondary)}
.dcm-caret{display:inline-block;width:9px;transition:transform .14s;font-size:9px;line-height:1}
.dcm-gh[data-closed="1"] .dcm-caret{transform:rotate(-90deg)}
.dcm-n{font-size:10.5px;line-height:15px;padding:0 5px;border-radius:999px;background:var(--cm-hover);color:var(--dsw-alias-label-tertiary);min-width:15px;text-align:center;font-weight:600}
.dcm-item{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:9px;border:1px solid transparent;transition:background .12s,border-color .12s;min-width:0}
.dcm-item:hover{background:var(--cm-hover)}
.dcm-item[data-on="1"]{background:var(--cm-active);border-color:var(--cm-hairline-strong)}
.dcm-itemmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;text-align:left;border:none;background:transparent;padding:0;font:inherit;color:inherit;cursor:pointer}
.dcm-name{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcm-sub{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.dcm-chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:2px}
.dcm-chip{font-size:10.5px;line-height:16px;padding:0 7px;border-radius:999px;border:1px solid var(--cm-hairline-strong);color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dcm-sw{position:relative;flex:none;width:30px;height:17px;margin-top:2px;border-radius:999px;border:1px solid var(--cm-hairline-strong);background:transparent;padding:0;cursor:pointer;transition:background .14s,border-color .14s}
.dcm-sw::after{content:"";position:absolute;top:1.5px;left:1.5px;width:11px;height:11px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:transform .14s,background .14s}
.dcm-sw[data-on="1"]{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,transparent)}
.dcm-sw[data-on="1"]::after{transform:translateX(13px);background:var(--dsw-alias-brand-primary)}
.dcm-sw:disabled{opacity:.4;cursor:default}
.dcm-sw:not(:disabled):hover{border-color:var(--dsw-alias-brand-primary)}
.dcm-path{font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all;line-height:1.45;flex:1;min-width:0;max-height:2.9em;overflow:hidden}
.dcm-editor{flex:1;min-height:0;width:100%;resize:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.62;tab-size:2;color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-brand-primary);background:var(--cm-code);backdrop-filter:var(--cm-blur);-webkit-backdrop-filter:var(--cm-blur);border:1px solid var(--cm-hairline);border-radius:12px;padding:12px 14px;outline:none;white-space:pre-wrap;overflow-wrap:break-word;overflow:auto;transition:border-color .14s}
.dcm-editor:focus{border-color:var(--dsw-alias-brand-primary)}
.dcm-editor:disabled{opacity:.55}
.dcm-foot{display:flex;align-items:center;gap:8px;font-size:11.5px;min-height:20px;color:var(--dsw-alias-label-secondary);flex:none}
.dcm-led{width:6px;height:6px;border-radius:3px;flex:none}
.dcm-notice{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;line-height:1.55;padding:7px 11px;border-radius:9px;flex:none}
.dcm-notice[data-tone="warn"]{border:1px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.dcm-notice[data-tone="error"]{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dcm-notice[data-tone="info"]{border:1px solid var(--cm-hairline-strong);color:var(--dsw-alias-label-secondary)}
.dcm-wire{display:flex;align-items:center;gap:10px;padding:8px 11px;border-radius:10px;border:1px solid var(--dsw-alias-state-warn-primary);flex:none;margin:2px 8px 4px}
.dcm-wiretext{display:flex;flex-direction:column;gap:2px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-state-warn-primary);min-width:0;flex:1}
.dcm-input{width:100%;font:inherit;font-size:12px;padding:5px 8px;border-radius:8px;border:1px solid var(--cm-hairline-strong);background:transparent;color:var(--dsw-alias-label-primary);outline:none;transition:border-color .12s}
.dcm-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dcm-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dcm-form{display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:10px;border:1px dashed var(--cm-hairline-strong);margin:4px 8px}
.dcm-actions{display:flex;gap:6px;justify-content:flex-end}
.dcm-empty{margin:auto;display:flex;flex-direction:column;gap:5px;align-items:center;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;padding:26px 16px;max-width:340px}
.dcm-empty b{color:var(--dsw-alias-label-secondary);font-weight:600;font-size:12.5px}
.dcm *::-webkit-scrollbar{width:9px;height:9px}
.dcm *::-webkit-scrollbar-thumb{background:var(--cm-hairline-strong);border-radius:5px;border:2px solid transparent;background-clip:padding-box}
.dcm *::-webkit-scrollbar-track{background:transparent}

/* ── contrast guard ────────────────────────────────────────────────────────
   The panel floats over the user's wallpaper, so nothing that carries text may
   inherit its colour from the theme: a bright theme paints "solid" buttons
   white-on-white. These rules take text, surfaces and the accent from our own
   palette, and keep the panel legible on any background. */
.dcm{color:var(--cm-text)}
.dcm-list{background:var(--cm-card);border-color:var(--cm-hairline)}
.dcm-picks{background:var(--cm-card)}
.dcm-name{color:var(--cm-text)}
.dcm-sub,.dcm-foot,.dcm-hint,.dcm-count,.dcm-path,.dcm-empty,.dcm-note{color:var(--cm-text-dim)}
.dcm-gh{color:var(--cm-text-dim)}
.dcm-gh:hover{color:var(--cm-text)}
.dcm-n{color:var(--cm-text-dim);background:var(--cm-hover)}
.dcm-chip{color:var(--cm-text-dim);border-color:var(--cm-hairline-strong)}
.dcm-pick{color:var(--cm-text-dim)}
.dcm-pick[data-on="1"]{color:var(--cm-text);background:var(--cm-active)}
.dcm-btn{color:var(--cm-text);border-color:var(--cm-hairline-strong)}
.dcm-btn[data-kind="ghost"]{color:var(--cm-text-dim)}
.dcm-btn[data-kind="ghost"]:hover:not(:disabled){color:var(--cm-text)}
.dcm-btn[data-kind="solid"]{background:var(--cm-accent);border-color:transparent;color:#fff}
.dcm-btn[data-kind="solid"]:hover:not(:disabled){background:var(--cm-accent);filter:brightness(1.12)}
.dcm-sw{border-color:var(--cm-hairline-strong)}
.dcm-sw::after{background:var(--cm-text-dim)}
.dcm-sw[data-on="1"]{border-color:var(--cm-accent);background:color-mix(in srgb,var(--cm-accent) 30%,transparent)}
.dcm-sw[data-on="1"]::after{background:var(--cm-accent)}
.dcm-editor{color:var(--cm-text);background:var(--cm-code);border-color:var(--cm-hairline)}
.dcm-editor::placeholder{color:var(--cm-text-dim)}
.dcm-input{color:var(--cm-text);border-color:var(--cm-hairline-strong)}
.dcm-input::placeholder{color:var(--cm-text-dim)}
.dcm-select{background:var(--cm-card);color:var(--cm-text);appearance:none;padding-right:22px}
.dcm-select option{background:var(--cm-card);color:var(--cm-text)}
.dcm-form{border-color:var(--cm-hairline-strong)}
.dcm-wire{background:var(--cm-wire-tint);border-color:var(--cm-warn)}
.dcm-wiretext{color:var(--cm-warn)}
.dcm-notice[data-tone="info"]{color:var(--cm-text-dim);border-color:var(--cm-hairline-strong)}
.dcm-notice[data-tone="warn"]{color:var(--cm-warn);border-color:var(--cm-warn)}
.dcm-notice[data-tone="error"]{color:var(--cm-error);border-color:var(--cm-error)}
.dcm .dcm-install .dcm-chip{color:var(--cm-text-dim)}
`

    function installStyles() {
      if (typeof document === 'undefined') return
      const head = document.head || document.documentElement
      if (!head) return
      let element = document.getElementById(STYLE_ID)
      if (!element) {
        element = document.createElement('style')
        element.id = STYLE_ID
        head.appendChild(element)
      }
      element.textContent = STYLES
    }

    /* ── helpers ── */
    function confirmText(message) {
      try {
        return window.confirm(message)
      } catch {
        return false
      }
    }

    function formatSize(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return ''
      return bytes < 1024 ? bytes + ' ' + t('unit.bytes') : (bytes / 1024).toFixed(1) + ' ' + t('unit.kb')
    }

    function statusColor(error, dirty, saved) {
      if (error) return 'var(--dsw-alias-state-error-primary)'
      if (dirty) return 'var(--dsw-alias-state-warn-primary)'
      if (saved) return 'var(--dsw-alias-state-success-primary)'
      return 'var(--dsw-alias-state-idle-primary)'
    }

    function statusLabel(error, dirty, saved) {
      if (error) return error
      if (dirty) return t('state.dirty')
      if (saved) return t('state.saved')
      return t('state.clean')
    }

    /* ── small components ── */
    function StudioIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 20
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }),
        h('path', { d: 'M9 4v16' }),
        h('path', { d: 'M12.5 9h5.5' }),
        h('path', { d: 'M12.5 13h5.5' }),
        h('path', { d: 'M12.5 17h3' }),
      )
    }

    function Switch(props) {
      return h('button', {
        type: 'button',
        className: 'dcm-sw',
        'data-on': props.on ? '1' : '0',
        disabled: props.disabled,
        title: props.title || '',
        'aria-label': props.label || '',
        onClick: props.onChange,
      })
    }

    function Chip(props) {
      return h('span', { className: 'dcm-chip', title: props.title || '' }, props.text)
    }

    function Notice(props) {
      return h('div', { className: 'dcm-notice', 'data-tone': props.tone || 'info' }, props.children)
    }

    function Empty(props) {
      return h('div', { className: 'dcm-empty' }, h('b', null, props.title), props.hint ? h('span', null, props.hint) : null)
    }

    function useFileEditor(onDirty) {
      const [path, setPath] = useState(null)
      const [text, setText] = useState('')
      const [mtime, setMtime] = useState(null)
      const [dirty, setDirty] = useState(false)
      const [saved, setSaved] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [conflict, setConflict] = useState(null)

      useEffect(() => {
        if (onDirty) onDirty(dirty)
      }, [dirty, onDirty])

      const reset = useCallback(() => {
        setPath(null)
        setText('')
        setMtime(null)
        setDirty(false)
        setSaved(false)
        setError(null)
        setConflict(null)
      }, [])

      const open = useCallback(async (target) => {
        if (!target || !target.path) return
        setBusy(true)
        try {
          const data = await request(API.read + '?path=' + encodeURIComponent(target.path))
          setPath(target.path)
          setText(typeof data.content === 'string' ? data.content : '')
          setMtime(typeof data.mtime === 'number' ? data.mtime : null)
          setDirty(false)
          setSaved(false)
          setError(null)
          setConflict(null)
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [])

      const save = useCallback(async () => {
        if (!path || busy) return
        setBusy(true)
        try {
          const data = await request(API.write, { method: 'POST', body: { path, content: text, baseMtime: mtime } })
          setMtime(typeof data.mtime === 'number' ? data.mtime : mtime)
          setDirty(false)
          setSaved(true)
          setError(null)
          setConflict(null)
        } catch (failure) {
          setError(failure.message)
          if (failure.status === 409 && failure.body) setConflict({ content: failure.body.content, mtime: failure.body.mtime })
        } finally {
          setBusy(false)
        }
      }, [path, text, mtime, busy])

      const change = useCallback((value) => {
        setText(value)
        setDirty(true)
        setSaved(false)
      }, [])

      const takeDisk = useCallback(() => {
        if (!conflict) return
        setText(typeof conflict.content === 'string' ? conflict.content : '')
        setMtime(typeof conflict.mtime === 'number' ? conflict.mtime : null)
        setDirty(false)
        setSaved(false)
        setError(null)
        setConflict(null)
      }, [conflict])

      const onKeyDown = useCallback(
        (event) => {
          if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
            event.preventDefault()
            save()
          }
        },
        [save],
      )

      return { path, text, dirty, saved, busy, error, conflict, open, save, reset, change, takeDisk, onKeyDown }
    }

    function EditorBox(props) {
      const ed = props.editor
      const lineCount = ed.text === '' ? 0 : ed.text.split('\n').length
      return h(
        'div',
        { className: 'dcm-main' },
        h(
          'div',
          { className: 'dcm-bar' },
          h('span', { className: 'dcm-path', title: ed.path || '' }, ed.path || ''),
          h(
            'button',
            { type: 'button', className: 'dcm-btn', disabled: !ed.path || ed.busy, onClick: () => ed.open({ path: ed.path }) },
            t('action.reload'),
          ),
          h(
            'button',
            { type: 'button', className: 'dcm-btn', 'data-kind': 'solid', disabled: !ed.path || ed.busy || !ed.dirty, onClick: () => ed.save() },
            t('action.save'),
          ),
        ),
        ed.conflict
          ? h(
              'div',
              { className: 'dcm-wire' },
              h('div', { className: 'dcm-wiretext' }, h('b', null, '磁盘上的文件变过了'), h('span', null, '保存会覆盖它。')),
              h('button', { type: 'button', className: 'dcm-btn', onClick: () => ed.takeDisk() }, t('action.takeDisk')),
            )
          : null,
        ed.error ? h(Notice, { tone: 'error' }, ed.error) : null,
        h('textarea', {
          className: 'dcm-editor',
          value: ed.text,
          spellCheck: false,
          disabled: !ed.path || ed.busy,
          placeholder: props.empty,
          onChange: (event) => ed.change(event.target.value),
          onKeyDown: ed.onKeyDown,
        }),
        h(
          'div',
          { className: 'dcm-foot' },
          h('span', { className: 'dcm-led', style: { background: statusColor(ed.error, ed.dirty, ed.saved) } }),
          h('span', null, statusLabel(ed.error, ed.dirty, ed.saved)),
          h('span', { className: 'dcm-grow' }),
          h('span', null, lineCount + ' ' + t('unit.lines') + ' · ' + formatSize(new TextEncoder().encode(ed.text).length)),
        ),
      )
    }

    /* ── the one page: every entry type in one list ── */
    function StudioPage() {
      const mode = useMode()
      const [data, setData] = useState({ roots: [], types: [], tools: [], presets: [] })
      const [selected, setSelected] = useState(null)
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState(null)
      const [installBusy, setInstallBusy] = useState(false)
      const [closed, setClosed] = useState({})
      const [creating, setCreating] = useState(null)
      const [draft, setDraft] = useState({})
      const [newOpen, setNewOpen] = useState(false)
      const [newDraft, setNewDraft] = useState({})
      const [busy, setBusy] = useState(false)
      const ed = useFileEditor(null)

      const reload = useCallback(async () => {
        setLoading(true)
        try {
          const next = await request(API.presets)
          setData(next)
          setSelected((current) =>
            (next.presets || []).some((item) => item.dir === current) ? current : next.presets && next.presets[0] ? next.presets[0].dir : null,
          )
          setError(null)
        } catch (failure) {
          setError(failure.message)
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        reload()
      }, [reload])

      const preset = (data.presets || []).find((item) => item.dir === selected) || (data.presets || [])[0] || null
      const types = data.types || []

      useEffect(() => {
        ed.reset()
        setCreating(null)
        setDraft({})
      }, [preset ? preset.dir : null])

      const openEntry = (entry) => {
        if (ed.dirty && ed.path && ed.path !== entry.path && !confirmText(t('confirm.discard'))) return
        ed.open(entry)
      }

      const toggleEntry = async (type, entry) => {
        setBusy(true)
        try {
          if (type.id === 'tool') {
            await request(API.toolToggle, { method: 'POST', body: { preset: preset.dir, id: entry.id, enabled: !entry.enabled } })
          } else {
            await request(API.toggle, { method: 'POST', body: { type: type.id, path: entry.path, enabled: !entry.enabled } })
          }
          setError(null)
          await reload()
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }

      const create = async (type, values) => {
        setBusy(true)
        try {
          const result = await request(API.create, { method: 'POST', body: { preset: preset.dir, type: type.id, values } })
          setCreating(null)
          setError(null)
          await reload()
          if (result && result.path) ed.open({ path: result.path })
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }

      const addTool = async (id) => {
        setBusy(true)
        try {
          await request(API.toolAdd, { method: 'POST', body: { preset: preset.dir, id } })
          setError(null)
          await reload()
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }

      const wire = async (type) => {
        setBusy(true)
        try {
          await request(API.wire, { method: 'POST', body: { preset: preset.dir, type: type.id } })
          setError(null)
          await reload()
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }

      const createPreset = async () => {
        if (busy) return
        setBusy(true)
        try {
          const result = await request(API.presetCreate, { method: 'POST', body: { title: newDraft.title || '', id: newDraft.id || '' } })
          setNewOpen(false)
          setNewDraft({})
          setError(null)
          await reload()
          if (result && result.dir) setSelected(result.dir)
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }

      const runInstall = async (route) => {        if (!preset || installBusy) return
        setInstallBusy(true)
        setError(null)
        try {
          await request(route, { method: 'POST', body: { preset: preset.dir } })
        } catch (failure) {
          if (failure && typeof failure.status === 'number') setError(failure.message)
        } finally {
          await new Promise((resolve) => setTimeout(resolve, 900))
          await reload()
          setInstallBusy(false)
        }
      }

      const p = palette(mode)
      const rootStyle = {
        '--cm-surface': p.surface,
        '--cm-code': p.code,
        '--cm-card': p.card,
        '--cm-hairline': p.hairline,
        '--cm-hairline-strong': p.hairlineStrong,
        '--cm-active': p.active,
        '--cm-hover': p.hover,
        '--cm-blur': p.blur,
        '--cm-text': p.text,
        '--cm-text-dim': p.textDim,
        '--cm-accent': p.accent,
        '--cm-warn': p.warn,
        '--cm-error': p.error,
        '--cm-wire-tint': p.wireTint,
      }

      /* ── a create form for one type ── */
      const createForm = (type) => {
        if (type.create.hasCatalog) {
          const taken = new Set(((preset.entries.tool || {}).items || []).map((item) => item.id))
          const choices = (data.tools || []).filter((item) => !taken.has(item.id))
          return h(
            'div',
            { className: 'dcm-form' },
            choices.length === 0
              ? h('span', { className: 'dcm-sub' }, '能加的工具都加完了。')
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                  ...choices.map((item) =>
                    h(
                      'button',
                      {
                        key: item.id,
                        type: 'button',
                        className: 'dcm-btn',
                        'data-kind': 'ghost',
                        style: { justifyContent: 'flex-start', textAlign: 'left' },
                        disabled: busy,
                        onClick: () => addTool(item.id),
                      },
                      item.label + ' · ' + item.hint,
                    ),
                  ),
                ),
            h(
              'div',
              { className: 'dcm-actions' },
              h('button', { type: 'button', className: 'dcm-btn', 'data-kind': 'ghost', onClick: () => setCreating(null) }, t('action.cancel')),
            ),
          )
        }
        return h(
          'div',
          { className: 'dcm-form' },
          ...(type.create.fields || []).map((field) => {
            const setValue = (value) => setDraft((current) => ({ ...current, [field.key]: value }))
            const control =
              field.kind === 'select'
                ? h(
                    'select',
                    {
                      key: field.key,
                      className: 'dcm-input dcm-select',
                      value: draft[field.key] !== undefined ? draft[field.key] : field.default,
                      onChange: (event) => setValue(event.target.value),
                    },
                    ...(field.options || []).map((option) => h('option', { key: option.value, value: option.value }, option.label)),
                  )
                : h('input', {
                    key: field.key,
                    className: 'dcm-input',
                    type: field.kind === 'number' ? 'number' : 'text',
                    value: draft[field.key] !== undefined ? draft[field.key] : field.default !== undefined ? String(field.default) : '',
                    placeholder: field.label,
                    spellCheck: false,
                    onChange: (event) => setValue(event.target.value),
                  })
            return h(
              'div',
              { key: 'f-' + field.key, style: { display: 'flex', flexDirection: 'column', gap: 2 } },
              control,
              field.hint ? h('span', { className: 'dcm-note' }, field.hint) : null,
            )
          }),
          h(
            'div',
            { className: 'dcm-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dcm-btn',
                'data-kind': 'ghost',
                onClick: () => {
                  setCreating(null)
                  setDraft({})
                },
              },
              t('action.cancel'),
            ),
            h('button', { type: 'button', className: 'dcm-btn', 'data-kind': 'solid', disabled: busy, onClick: () => create(type, draft) }, t('action.create')),
          ),
        )
      }

      /* ── one entry row ── */
      const entryRow = (type, entry) => {
        const chips = []
        if (type.id === 'inject') {
          chips.push(h(Chip, { key: 'r', text: entry.role === 'system' ? '系统提示词' : entry.role === 'user' ? '对话上下文' : '助手块' }))
          chips.push(h(Chip, { key: 'o', text: '序号 ' + entry.order }))
        }
        if (type.id === 'doc') chips.push(h(Chip, { key: 'c', text: (entry.chars || 0) + ' ' + t('unit.chars') }))
        if (entry.valid === false) chips.push(h(Chip, { key: 'w', text: '⚠ 缺字段' }))
        const switchable = type.id !== 'files' && type.toggleField !== null
        return h(
          'div',
          { key: entry.path || entry.id, className: 'dcm-item', 'data-on': ed.path === entry.path ? '1' : '0' },
          h(
            'button',
            { type: 'button', className: 'dcm-itemmain', title: entry.path || '', onClick: () => (entry.path ? openEntry(entry) : null) },
            h('span', { className: 'dcm-name' }, entry.name || entry.id),
            h('span', { className: 'dcm-sub' }, entry.preview || entry.description || entry.packageName || ''),
            chips.length > 0 ? h('span', { className: 'dcm-chips' }, ...chips) : null,
          ),
          switchable
            ? h(Switch, {
                on: entry.enabled,
                disabled: busy || entry.auto === true || entry.valid === false,
                label: entry.name || entry.id,
                title: entry.auto ? t('notice.toolAuto') : '',
                onChange: () => toggleEntry(type, entry),
              })
            : null,
        )
      }

      /* ── one type group ── */
      const group = (type) => {
        const section = preset ? preset.entries[type.id] : null
        const items = type.id === 'files' ? preset.files : section ? section.items : []
        const isClosed = closed[type.id] === true
        const wiring = section ? section.wiring : null
        const missing = wiring && wiring.missing.length > 0
        const head = h(
          'button',
          {
            type: 'button',
            className: 'dcm-gh',
            'data-closed': isClosed ? '1' : '0',
            onClick: () => setClosed((current) => ({ ...current, [type.id]: !current[type.id] })),
          },
          h('span', { className: 'dcm-caret' }, '▾'),
          h('span', null, type.label),
          h('span', { className: 'dcm-n' }, items.length),
          h('span', { className: 'dcm-grow' }),
          wiring && type.consumers.length > 0 && !missing ? h(Chip, { text: t('state.wired') }) : null,
          missing ? h(Chip, { text: '未接上' }) : null,
        )
        return h(
          'div',
          { key: type.id },
          head,
          isClosed
            ? null
            : h(
                'div',
                null,
                missing
                  ? h(
                      'div',
                      { className: 'dcm-wire' },
                      h('div', { className: 'dcm-wiretext' }, h('b', null, t('wire.missing')), h('span', null, wiring.missing.join('、'))),
                      h('button', { type: 'button', className: 'dcm-btn', 'data-kind': 'solid', disabled: busy, onClick: () => wire(type) }, t('action.wire')),
                    )
                  : null,
                ...items.map((entry) => entryRow(type, entry)),
                items.length === 0 ? h(Empty, { title: t('notice.empty') }) : null,
                type.create
                  ? creating === type.id
                    ? createForm(type)
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: 'dcm-btn',
                          'data-kind': 'ghost',
                          style: { marginTop: 4, alignSelf: 'flex-start', marginLeft: 6 },
                          onClick: () => {
                            const seed = {}
                            for (const field of type.create.fields || []) {
                              if (field.default !== undefined) seed[field.key] = String(field.default)
                            }
                            setDraft(seed)
                            setCreating(type.id)
                          },
                        },
                        '+ ' + type.label,
                      )
                  : null,
              ),
        )
      }

      const installControl = !preset
        ? null
        : preset.bundle
          ? h(
              'span',
              { className: 'dcm-install' },
              h('span', { className: 'dcm-chip', title: preset.bundle.name }, t('state.installed')),
              preset.bundle.removable
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dcm-btn',
                      'data-kind': 'ghost',
                      disabled: installBusy,
                      onClick: () => {
                        if (confirmText(t('confirm.uninstall'))) runInstall(API.uninstall)
                      },
                    },
                    installBusy ? t('state.removing') : t('action.uninstall'),
                  )
                : null,
            )
          : h(
              'button',
              { type: 'button', className: 'dcm-btn', 'data-kind': 'solid', disabled: installBusy, onClick: () => runInstall(API.install) },
              installBusy ? t('state.installing') : t('action.install'),
            )

      return h(
        'div',
        { className: 'dcm', style: rootStyle },
        h(
          'div',
          { className: 'dcm-head' },
          h('h2', { className: 'dcm-title' }, t('page.title')),
          h('span', { className: 'dcm-sep' }),
          h(
            'div',
            { className: 'dcm-picks' },
            ...(data.presets || []).map((item) =>
              h(
                'button',
                { key: item.dir, type: 'button', className: 'dcm-pick', 'data-on': preset && preset.dir === item.dir ? '1' : '0', onClick: () => setSelected(item.dir) },
                item.name,
              ),
            ),
          ),
          h('span', { className: 'dcm-grow' }),
          h(
            'button',
            {
              type: 'button',
              className: 'dcm-btn',
              'data-kind': 'ghost',
              title: data.template && data.template.exists ? data.template.dir : (data.template && data.template.reason) || '',
              onClick: () => {
                setNewDraft({})
                setNewOpen(true)
              },
            },
            '+ 新建预设',
          ),
          installControl,
          h('button', { type: 'button', className: 'dcm-btn', 'data-kind': 'ghost', disabled: loading, onClick: () => reload() }, t('action.refresh')),
        ),
        newOpen
          ? h(
              'div',
              { className: 'dcm-bar', style: { padding: '0 18px 8px', gap: 6 } },
              h('input', {
                className: 'dcm-input',
                style: { maxWidth: 220 },
                placeholder: '显示名（中文可以）',
                onChange: (event) => setNewDraft((current) => ({ ...current, title: event.target.value })),
              }),
              h('input', {
                className: 'dcm-input',
                style: { maxWidth: 210 },
                placeholder: 'id（小写英文，如 my-preset）',
                spellCheck: false,
                onChange: (event) => setNewDraft((current) => ({ ...current, id: event.target.value })),
              }),
              h('button', { type: 'button', className: 'dcm-btn', 'data-kind': 'solid', disabled: busy, onClick: () => createPreset() }, '创建'),
              h('button', { type: 'button', className: 'dcm-btn', 'data-kind': 'ghost', onClick: () => setNewOpen(false) }, t('action.cancel')),
              data.template && data.template.exists
                ? h('span', { className: 'dcm-sub' }, '从模板复制，接线会自动写好')
                : h('span', { className: 'dcm-sub' }, (data.template && data.template.reason) || '模板缺失'),
            )
          : null,
        error ? h('div', { style: { padding: '0 18px 6px' } }, h(Notice, { tone: 'error' }, error)) : null,
        (data.presets || []).length === 0
          ? h(Empty, { title: t('page.empty'), hint: t('page.emptyHint') })
          : h(
              'div',
              { className: 'dcm-body' },
              h('div', { className: 'dcm-list' }, ...types.map(group)),
              h(EditorBox, { editor: ed, empty: t('notice.pick') }),
            ),
      )
    }

    const PANEL_ID = 'studio'
    const PANEL_ORDER = 40

    return {
      inject: ['slots', 'locale', 'theme'],
      apply(ctx) {
        installStyles()
        try {
          ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'studio: dictionaries')
        } catch {}
        try {
          const bound = ctx.locale.bind(NS)
          if (typeof bound === 'function') translate = bound
        } catch {}

        const syncTheme = () => {
          try {
            const snapshot = ctx.theme.getTheme()
            themeStore.set(snapshot && snapshot.active ? snapshot.active.colorScheme : 'dark')
          } catch {
            themeStore.set('dark')
          }
        }
        syncTheme()
        try {
          ctx.on('theme/change', syncTheme)
        } catch {}

        const disposers = []
        try {
          disposers.push(
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => t('panel.label') }, StudioIcon),
            ),
          )
          disposers.push(ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, StudioPage)))
        } catch (failure) {
          console.warn('[studio] panel registration failed:', failure)
        }
        ctx.effect(() => () => {
          for (const dispose of disposers.splice(0)) dispose()
        }, 'studio: ui mounts')
      },
    }
  },
})
