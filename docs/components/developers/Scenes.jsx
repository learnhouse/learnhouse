// Illustrations for the Developers section, drawn as LearnHouse's own UI:
// white surfaces, neutral greys, and colour only where a real block has it
// (the quiz's correct answer, flipcards, the tip callout).

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const N = {
  line: '#ececec',
  bar: '#e5e5e5',
  barDark: '#d4d4d4',
  ink: '#262626',
  muted: '#a3a3a3',
  surface: '#fafafa',
}

function Window({ x, y, w, h, url, children }) {
  return (
    <g>
      <rect x={x} y={y + 2} width={w} height={h} rx="12" fill="#000" opacity="0.025" />
      <rect x={x} y={y} width={w} height={h} rx="12" fill="#fff" stroke={N.line} />
      <circle cx={x + 15} cy={y + 14} r="3" fill={N.bar} />
      <circle cx={x + 25} cy={y + 14} r="3" fill={N.bar} />
      <circle cx={x + 35} cy={y + 14} r="3" fill={N.bar} />
      {url && (
        <>
          <rect x={x + 48} y={y + 7} width={Math.min(150, w - 62)} height="14" rx="7" fill="#f5f5f5" />
          <text x={x + 56} y={y + 17.5} fontSize="8" fill={N.muted} fontFamily={mono}>{url}</text>
        </>
      )}
      {children}
    </g>
  )
}

function Code({ x, y, w, h, children }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="12" fill="#171717" />
      <circle cx={x + 15} cy={y + 14} r="3" fill="#404040" />
      <circle cx={x + 25} cy={y + 14} r="3" fill="#404040" />
      <circle cx={x + 35} cy={y + 14} r="3" fill="#404040" />
      {children}
    </g>
  )
}

const Bar = ({ x, y, w, c = N.bar, h = 6 }) => <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={c} />
const Label = ({ x, y, children }) => (
  <text x={x} y={y} fontSize="7" fontWeight="700" letterSpacing="0.6" fill={N.muted}>{children}</text>
)

function QuizBlock({ x, y, w }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height="100" rx="10" fill={N.surface} stroke="#f0f0f0" />
      <Label x={x + 12} y={y + 16}>INTERACTIVE QUIZ</Label>
      <Bar x={x + 12} y={y + 23} w={w * 0.55} h={5} c={N.barDark} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={x + 8} y={y + 36 + i * 20} width={w - 16} height="16" rx="5" fill={i === 0 ? '#ecfdf5' : '#fff'} stroke={i === 0 ? '#bbf7d0' : '#f0f0f0'} />
          <rect x={x + 13} y={y + 40 + i * 20} width="8" height="8" rx="2.5" fill={i === 0 ? '#10b981' : '#f5f5f5'} />
          <Bar x={x + 27} y={y + 42 + i * 20} w={[70, 44, 58][i]} h={4} c={i === 0 ? '#86efac' : N.bar} />
          {i === 0 && <path d={`M${x + w - 22} ${y + 44} l2.5 2.5 l5 -5`} fill="none" stroke="#10b981" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />}
        </g>
      ))}
    </g>
  )
}

export function EmbedScene() {
  return (
    <svg className="lhd-scene" viewBox="0 0 400 250" role="img" aria-label="An activity embedded in another website with an iframe">
      <Window x={6} y={6} w={388} h={238} url="your-site.com/blog/payouts">
        <Bar x={26} y={40} w={140} h={8} c={N.ink} />
        <Bar x={26} y={58} w={320} />
        <Bar x={26} y={70} w={296} />
        <Bar x={26} y={82} w={210} />
        <rect x={26} y={102} width="348" height="126" rx="10" fill="none" stroke={N.barDark} strokeDasharray="4 4" />
        <rect x={36} y={95} width="50" height="14" rx="5" fill="#171717" />
        <text x={61} y={105} fontSize="8" fill="#fff" fontFamily={mono} textAnchor="middle">{'<iframe>'}</text>
        <QuizBlock x={40} y={116} w={320} />
      </Window>
    </svg>
  )
}

export function ReactScene() {
  return (
    <svg className="lhd-scene" viewBox="0 0 400 250" role="img" aria-label="The LearnHouseActivity component rendering lesson blocks inside a React app">
      <Code x={6} y={42} w={172} h={146}>
        <text fontFamily={mono} fontSize="9">
          <tspan x="20" y="76" fill="#fafafa">{'<LearnHouseActivity'}</tspan>
          <tspan x="32" y="94" fill="#a3a3a3">activityId</tspan>
          <tspan fill="#737373">=</tspan>
          <tspan fill="#86efac">{'"activity_…"'}</tspan>
          <tspan x="32" y="112" fill="#a3a3a3">theme</tspan>
          <tspan fill="#737373">{'={theme}'}</tspan>
          <tspan x="32" y="130" fill="#a3a3a3">components</tspan>
          <tspan fill="#737373">{'={…}'}</tspan>
          <tspan x="32" y="148" fill="#a3a3a3">onEvent</tspan>
          <tspan fill="#737373">{'={track}'}</tspan>
          <tspan x="20" y="166" fill="#fafafa">{'/>'}</tspan>
        </text>
      </Code>
      <path d="M184 115 h18" stroke={N.barDark} strokeWidth="1.5" />
      <path d="M198 111 l5 4 l-5 4" fill="none" stroke={N.barDark} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <Window x={210} y={6} w={184} h={238} url="your app">
        <Bar x={224} y={38} w={96} h={8} c={N.ink} />
        <Bar x={224} y={55} w={152} />
        <Bar x={224} y={66} w={128} />
        <rect x={224} y={80} width="156" height="22" rx="7" fill="#f0fdf4" />
        <circle cx={235} cy={91} r="4" fill="#22c55e" />
        <Bar x={245} y={89} w={100} h={4} c="#86efac" />
        <rect x={224} y={110} width="75" height="46" rx="8" fill="#3b82f6" />
        <rect x={305} y={110} width="75" height="46" rx="8" fill="#10b981" />
        <Bar x={240} y={131} w={44} h={4} c="#bfdbfe" />
        <Bar x={321} y={131} w={44} h={4} c="#a7f3d0" />
        <rect x={224} y={164} width="156" height="66" rx="8" fill={N.surface} stroke="#f0f0f0" />
        <Label x={233} y={177}>INTERACTIVE QUIZ</Label>
        {[0, 1].map((i) => (
          <rect key={i} x={230} y={186 + i * 18} width="144" height="13" rx="4" fill="#fff" stroke="#f0f0f0" />
        ))}
      </Window>
    </svg>
  )
}

export function VueScene() {
  return (
    <svg className="lhd-scene" viewBox="0 0 400 250" role="img" aria-label="The Vue LearnHouseActivity component rendering lesson blocks inside a Vue app">
      <Code x={6} y={42} w={172} h={146}>
        <text fontFamily={mono} fontSize="9">
          <tspan x="20" y="76" fill="#fafafa">{'<LearnHouseActivity'}</tspan>
          <tspan x="32" y="94" fill="#a3a3a3">activity-id</tspan>
          <tspan fill="#737373">=</tspan>
          <tspan fill="#86efac">{'"activity_…"'}</tspan>
          <tspan x="32" y="112" fill="#a3a3a3">:theme</tspan>
          <tspan fill="#737373">=</tspan>
          <tspan fill="#86efac">{'"theme"'}</tspan>
          <tspan x="32" y="130" fill="#a3a3a3">@complete</tspan>
          <tspan fill="#737373">=</tspan>
          <tspan fill="#86efac">{'"next"'}</tspan>
          <tspan x="32" y="148" fill="#a3a3a3">#footer</tspan>
          <tspan fill="#737373">{'…'}</tspan>
          <tspan x="20" y="166" fill="#fafafa">{'/>'}</tspan>
        </text>
      </Code>
      <path d="M184 115 h18" stroke={N.barDark} strokeWidth="1.5" />
      <path d="M198 111 l5 4 l-5 4" fill="none" stroke={N.barDark} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <Window x={210} y={6} w={184} h={238} url="your vue app">
        <Bar x={224} y={38} w={96} h={8} c={N.ink} />
        <Bar x={224} y={55} w={152} />
        <Bar x={224} y={66} w={128} />
        <rect x={224} y={80} width="156" height="22" rx="7" fill="#f0fdf4" />
        <circle cx={235} cy={91} r="4" fill="#22c55e" />
        <Bar x={245} y={89} w={100} h={4} c="#86efac" />
        <rect x={224} y={110} width="156" height="66" rx="8" fill={N.surface} stroke="#f0f0f0" />
        <Label x={233} y={123}>INTERACTIVE QUIZ</Label>
        {[0, 1].map((i) => (
          <rect key={i} x={230} y={132 + i * 18} width="144" height="13" rx="4" fill="#fff" stroke="#f0f0f0" />
        ))}
        <rect x={224} y={186} width="156" height="40" rx="8" fill="none" stroke={N.barDark} strokeDasharray="4 4" />
        <Label x={233} y={200}>YOUR FOOTER SLOT</Label>
        <Bar x={233} y={208} w={70} h={4} />
      </Window>
    </svg>
  )
}

export function SdkScene() {
  const runtimes = ['Browser', 'Node', 'Bun', 'Deno', 'Edge', 'React Native']
  let x = 6
  return (
    <svg className="lhd-scene" viewBox="0 0 400 250" role="img" aria-label="TypeScript code using the LearnHouse SDK, and the runtimes it runs on">
      <Code x={6} y={6} w={388} h={178}>
        <text fontFamily={mono} fontSize="9.5">
          <tspan x="22" y="46" fill="#737373">import</tspan>
          <tspan fill="#fafafa">{' { createClient } '}</tspan>
          <tspan fill="#737373">from</tspan>
          <tspan fill="#86efac">{" '@learnhouse/sdk'"}</tspan>
          <tspan x="22" y="72" fill="#737373">const</tspan>
          <tspan fill="#fafafa">{' lh = createClient({ baseUrl, token })'}</tspan>
          <tspan x="22" y="98" fill="#737373">const</tspan>
          <tspan fill="#fafafa">{' course = '}</tspan>
          <tspan fill="#737373">await</tspan>
          <tspan fill="#fafafa">{' lh.courses.getMeta(id)'}</tspan>
          <tspan x="22" y="124" fill="#525252">{'//    ^? CourseMeta, typed from the API'}</tspan>
          <tspan x="22" y="146" fill="#fafafa">course.chapters[0].</tspan>
          <tspan fill="#a3a3a3">activities</tspan>
        </text>
        <rect x={130} y={153} width="112" height="20" rx="5" fill="#262626" stroke="#404040" />
        <text x={139} y={166} fontSize="8.5" fill="#d4d4d4" fontFamily={mono}>activities</text>
        <text x={194} y={166} fontSize="8" fill="#737373" fontFamily={mono}>Activity[]</text>
      </Code>
      {runtimes.map((label) => {
        const w = label.length * 5.6 + 20
        const el = (
          <g key={label}>
            <rect x={x} y={200} width={w} height="24" rx="8" fill="#fff" stroke={N.line} />
            <text x={x + w / 2} y={215.5} fontSize="9.5" fill="#525252" textAnchor="middle">{label}</text>
          </g>
        )
        x += w + 6
        return el
      })}
    </svg>
  )
}

export function ApiScene() {
  const rows = [
    ['GET', '/api/v1/courses/{course_uuid}/meta'],
    ['GET', '/api/v1/activities/{activity_uuid}'],
    ['POST', '/api/v1/trail/add_activity/{uuid}'],
    ['PUT', '/api/v1/users/{user_id}'],
  ]
  return (
    <svg className="lhd-scene" viewBox="0 0 400 250" role="img" aria-label="REST endpoints, and a webhook sent to your server">
      <rect x={6} y={8} width={276} height={176} rx="12" fill="#000" opacity="0.025" />
      <rect x={6} y={6} width={276} height={176} rx="12" fill="#fff" stroke={N.line} />
      <Label x={22} y={30}>REST API</Label>
      <text x={266} y={30} fontSize="8" fill={N.muted} fontFamily={mono} textAnchor="end">Bearer lh_…</text>
      {rows.map(([m, p], i) => (
        <g key={p}>
          <rect x={18} y={42 + i * 33} width="252" height="25" rx="7" fill={N.surface} />
          <rect x={24} y={48 + i * 33} width="34" height="13" rx="4" fill="#fff" stroke={N.line} />
          <text x={41} y={57.5 + i * 33} fontSize="7.5" fontWeight="700" fill="#525252" textAnchor="middle" fontFamily={mono}>{m}</text>
          <text x={66} y={58 + i * 33} fontSize="8" fill={N.ink} fontFamily={mono}>{p}</text>
        </g>
      ))}
      <path d="M282 94 C 320 94, 312 196, 332 196" fill="none" stroke={N.barDark} strokeWidth="1.5" strokeDasharray="4 4" />
      <rect x={300} y={202} width={94} height={42} rx="10" fill="#fff" stroke={N.line} />
      <text x={347} y={220} fontSize="9.5" fontWeight="600" fill={N.ink} textAnchor="middle">Your server</text>
      <text x={347} y={234} fontSize="8" fill={N.muted} textAnchor="middle" fontFamily={mono}>POST /webhook</text>
      <Bar x={18} y={204} w={190} h={6} />
      <Bar x={18} y={218} w={150} h={6} />
      <Bar x={18} y={232} w={170} h={6} />
    </svg>
  )
}

// One LearnHouse instance in the middle, the four ways around it.
export function OverviewScene() {
  const sats = [
    { x: 80, y: 46, label: 'Embed', sub: '<iframe>' },
    { x: 320, y: 46, label: 'React', sub: '<LearnHouseActivity />' },
    { x: 80, y: 204, label: 'SDK', sub: '@learnhouse/sdk' },
    { x: 320, y: 204, label: 'REST API', sub: '/api/v1 · webhooks' },
  ]
  return (
    <svg className="lhd-scene" viewBox="0 0 400 250" role="img" aria-label="A LearnHouse instance and four ways to build on it: embed, React, SDK and REST API">
      {sats.map((s) => (
        <path key={s.label} d={`M200 125 L${s.x} ${s.y}`} stroke={N.barDark} strokeWidth="1.2" strokeDasharray="3 4" />
      ))}
      <rect x="160" y="88" width="80" height="74" rx="14" fill="#fff" stroke={N.line} />
      <image href="/img/logos/lrn.svg" x="187" y="104" width="26" height="13" />
      <text x="200" y="140" fontSize="10" fontWeight="700" fill={N.ink} textAnchor="middle">LearnHouse</text>
      <text x="200" y="152" fontSize="7.5" fill={N.muted} textAnchor="middle" fontFamily={mono}>your instance</text>
      {sats.map((s) => (
        <g key={s.label}>
          <rect x={s.x - 66} y={s.y - 22} width="132" height="44" rx="10" fill="#fff" stroke={N.line} />
          <text x={s.x - 54} y={s.y - 2} fontSize="10.5" fontWeight="600" fill={N.ink}>{s.label}</text>
          <text x={s.x - 54} y={s.y + 11} fontSize="7.5" fill={N.muted} fontFamily={mono}>{s.sub}</text>
        </g>
      ))}
    </svg>
  )
}

export const SCENES = {
  overview: OverviewScene,
  embed: EmbedScene,
  react: ReactScene,
  vue: VueScene,
  sdk: SdkScene,
  api: ApiScene,
}
