import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, Pause, Play } from 'lucide-react';
import { useT, type User } from './common';

/** Original vector artwork. The reference film informs composition and motion,
 * not source code or assets. All pattern IDs are local to each illustration. */
export function CityIllustration() {
  const id = useId().replace(/:/g, '');
  const ref = (name: string) => `#${id}-${name}`;
  const fill = (name: string) => `url(${ref(name)})`;
  return (
    <svg
      className="city-illustration"
      viewBox="0 0 1440 420"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id={`${id}-dots`} width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.05" fill="var(--accent)" />
        </pattern>
        <pattern id={`${id}-fine`} width="3.5" height="3.5" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.65" fill="var(--ink)" />
        </pattern>
        <pattern id={`${id}-paper-dots`} width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="var(--paper)" />
        </pattern>
        <pattern id={`${id}-windows`} width="9" height="11" patternUnits="userSpaceOnUse">
          <rect width="9" height="11" fill="var(--ink)" />
          <path d="M2 2h2v6H2zM6 2h1v6H6z" fill="#e8e5de" />
        </pattern>
        <pattern id={`${id}-light-windows`} width="8" height="10" patternUnits="userSpaceOnUse">
          <rect width="8" height="10" fill="#efede8" />
          <path d="M2 2h2v5H2zM6 2h1v5H6z" fill="#686660" />
        </pattern>
        <pattern id={`${id}-round-windows`} width="11" height="12" patternUnits="userSpaceOnUse">
          <rect width="11" height="12" fill="#d7d4cc" />
          <circle cx="5.5" cy="6" r="2.5" fill="#343332" />
          <circle cx="5" cy="5.5" r="1" fill="var(--paper)" />
        </pattern>
        <pattern
          id={`${id}-hatch`}
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(25)"
        >
          <path d="M0 0v5" stroke="var(--accent)" strokeWidth="1.5" />
        </pattern>
        <pattern id={`${id}-facade`} width="7" height="7" patternUnits="userSpaceOnUse">
          <rect width="7" height="7" fill="#252525" />
          <path d="M2 0v7M0 3h7" stroke="#dcd9d1" strokeWidth="0.7" />
        </pattern>
        <g id={`${id}-tree`}>
          <path d="M0 0v43M0 24l-13-13M0 32l15-17" stroke="var(--ink)" strokeWidth="3" />
          <path
            d="M-5-19c-14-10-31 0-29 12-12 9-9 25 2 28 2 15 22 19 32 9 14 10 33 3 33-11 15-6 13-25 0-30-5-16-26-20-38-8Z"
            fill="var(--ink)"
          />
          <path
            d="M-5-19c-14-10-31 0-29 12-12 9-9 25 2 28 2 15 22 19 32 9 14 10 33 3 33-11 15-6 13-25 0-30-5-16-26-20-38-8Z"
            fill={fill('paper-dots')}
            opacity="0.58"
          />
          <path
            d="M-24-8c5-8 13-10 20-7M10-14c10-1 17 5 18 12M-25 12c5 7 11 9 17 7"
            stroke="#8b8982"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
        <g id={`${id}-cloud`}>
          <path
            d="M-70 9c-11-20 9-36 28-29 7-27 41-29 57-8 21-16 49-5 48 15 25-5 40 21 22 36-15 15-42 18-66 14-31 9-71 4-78-9-11 0-17-8-11-19Z"
            fill="#dee2f3"
          />
          <path
            d="M-70 9c-11-20 9-36 28-29 7-27 41-29 57-8 21-16 49-5 48 15 25-5 40 21 22 36-15 15-42 18-66 14-31 9-71 4-78-9-11 0-17-8-11-19Z"
            fill={fill('dots')}
            opacity="0.72"
          />
          <path
            d="M-61 9c21 10 43 8 60 16 24 9 58 7 78-7"
            stroke="var(--paper)"
            strokeWidth="9"
            opacity="0.4"
          />
        </g>
        {/* A single Hong Kong ding-ding: two decks, curved cab and a trailing trolley pole. */}
        <g
          id={`${id}-tram`}
          transform="translate(156 0) scale(-1 1)"
          stroke="var(--ink)"
          strokeWidth="1.2"
          strokeLinejoin="round"
        >
          <path d="M82-114v-6l36-22h8" strokeWidth="2" />
          <path d="M72-116h21v4H72Z" fill="var(--ink)" />
          <path d="M28-110h112q14 0 14 15v76q0 8-11 8H28Z" fill="var(--paper)" />
          <path d="M28-110Q3-109 3-94v72q0 11 25 11Z" fill="var(--paper)" />
          <path d="M28-113h111q11 0 15 9H28Q11-104 3-98q0-12 25-15Z" fill="var(--ink)" />
          <path d="M31-108h112M9-102q7-5 17-5" stroke="var(--paper)" strokeWidth="0.8" />

          {/* Upper saloon: tall timber-framed windows with a narrow transom. */}
          {[35, 54, 73, 92, 111, 130].map((x) => (
            <g key={x}>
              <rect x={x} y="-98" width="14" height="26" rx="1" fill="var(--ink)" />
              <path d={`M${x + 1}-90h12M${x + 5}-97v24`} stroke="var(--paper)" strokeWidth="0.8" />
              <path d={`M${x + 8}-87h4l-4 8Z`} fill="var(--paper)" opacity="0.25" stroke="none" />
            </g>
          ))}
          <path d="M8-95q4-3 7-3v25l-7 2ZM19-99l6-1v25l-6 1Z" fill="var(--ink)" />
          <path d="M9-86l5-1M20-89l4-1" stroke="var(--paper)" strokeWidth="0.8" />

          {/* Blue signwriting and a small orange destination plate use the site palette. */}
          <path d="M29-68h124v14H29Z" fill="var(--accent)" stroke="none" />
          <text
            x="91"
            y="-58.5"
            transform="translate(182 0) scale(-1 1)"
            textAnchor="middle"
            fill="var(--paper)"
            stroke="none"
            fontFamily="sans-serif"
            fontSize="6.7"
            fontWeight="600"
            letterSpacing="1.2"
          >
            NORBY · HONG KONG
          </text>
          <path d="M8-66l16-2v10L8-56Z" fill="var(--sun)" />
          <text
            x="16"
            y="-59.8"
            transform="translate(32 0) scale(-1 1)"
            textAnchor="middle"
            fill="var(--ink)"
            stroke="none"
            fontFamily="sans-serif"
            fontSize="5.2"
          >
            上環
          </text>
          <path d="M30-52h123" stroke="var(--sun)" strokeWidth="2" />

          {/* Lower deck, end door, headlamp and a skirt over the small steel wheels. */}
          {[54, 73, 92, 111].map((x) => (
            <g key={x}>
              <rect x={x} y="-48" width="14" height="23" rx="1" fill="var(--ink)" />
              <path d={`M${x + 1}-40h12M${x + 6}-47v21`} stroke="var(--paper)" strokeWidth="0.8" />
            </g>
          ))}
          <path d="M8-50l16-2v20L8-31Z" fill="var(--ink)" />
          <path d="M16-50v18M9-43l14-1" stroke="var(--paper)" strokeWidth="0.8" />
          <path d="M34-49h14v36H34ZM132-49h14v36h-14Z" fill="var(--paper)" />
          <path d="M37-45h8v19h-8ZM135-45h8v19h-8Z" fill="var(--ink)" />
          <path d="M41-24v10M139-24v10" strokeWidth="0.7" />
          <path d="M49-23h82v11H49ZM3-29l25 2v16Q3-10 3-22Z" fill="var(--accent)" />
          <path d="M49-23h82v11H49Z" fill={fill('paper-dots')} stroke="none" opacity="0.22" />
          <circle cx="16" cy="-22" r="4.2" fill="var(--paper)" />
          <circle cx="16" cy="-22" r="2.2" fill="var(--sun)" stroke="none" />
          <path d="M6-15h3M24-14h2" stroke="var(--sun)" strokeWidth="2" />
          <path d="M5-11l23 2h122v-4H28L5-15Z" fill="var(--ink)" />
          <circle cx="45" cy="-7" r="4" fill="var(--ink)" />
          <circle cx="124" cy="-7" r="4" fill="var(--ink)" />
          <circle cx="45" cy="-7" r="1.5" fill="var(--paper)" stroke="none" />
          <circle cx="124" cy="-7" r="1.5" fill="var(--paper)" stroke="none" />
        </g>
        <clipPath id={`${id}-rail-clip`}>
          <path d="M-5-155H850V3H-5z" />
        </clipPath>
      </defs>

      {/* Still landscape, with the sun printed behind the buildings. */}
      <circle cx="755" cy="238" r="166" fill="var(--sun)" />
      <path d="M594 275a166 166 0 0 0 322 0Z" fill={fill('dots')} opacity="0.11" />
      <path
        d="M300 355 360 322 413 333 490 279 538 297 611 229 664 269 711 250 769 304 839 284 950 346 1007 355Z"
        fill="#dbdee7"
      />
      <path
        d="M300 355 360 322 413 333 490 279 538 297 611 229 664 269 711 250 769 304 839 284 950 346 1007 355Z"
        fill={fill('fine')}
        opacity="0.5"
      />

      <g transform="translate(245 94)">
        <g className="city-cloud city-cloud-one">
          <use href={ref('cloud')} />
        </g>
      </g>
      <g transform="translate(694 62) scale(.78)">
        <g className="city-cloud city-cloud-two">
          <use href={ref('cloud')} />
        </g>
      </g>
      <g transform="translate(1135 110) scale(.64)">
        <g className="city-cloud city-cloud-three">
          <use href={ref('cloud')} />
        </g>
      </g>
      <g stroke="var(--accent)" strokeWidth="1.2">
        <path d="M75 135h12M81 129v12M1324 71h12M1330 65v12M928 47h9M932.5 42.5v9" />
        <circle cx="81" cy="135" r="3.5" />
        <circle cx="1330" cy="71" r="3.5" />
      </g>
      <g className="city-birds" stroke="var(--ink)" strokeWidth="1.4" strokeLinecap="round">
        <path d="M840 114q7-5 13 1 5-7 12-4M866 143q5-4 10 1 4-6 9-3M562 144q6-5 12 0 5-5 10-3" />
      </g>

      {/* A quieter, stippled second row of city blocks. */}
      <g fill="#ebedf8">
        <path d="M0 244h42v115H0zM49 277h35v82H49zM101 222h35v137h-35zM152 185h39v174h-39zM226 233h48v126h-48zM400 208h42v151h-42zM455 253h42v106h-42zM554 205h30v154h-30zM640 177h40v182h-40zM884 218h43v141h-43zM941 167h38v192h-38zM1096 239h43v120h-43zM1162 181h49v178h-49zM1324 188h47v171h-47zM1400 237h40v122h-40z" />
      </g>
      <path
        d="M0 244h42v115H0zM49 277h35v82H49zM101 222h35v137h-35zM152 185h39v174h-39zM226 233h48v126h-48zM400 208h42v151h-42zM455 253h42v106h-42zM554 205h30v154h-30zM640 177h40v182h-40zM884 218h43v141h-43zM941 167h38v192h-38zM1096 239h43v120h-43zM1162 181h49v178h-49zM1324 188h47v171h-47zM1400 237h40v122h-40z"
        fill={fill('dots')}
      />

      {/* Residential towers, Jardine House and the Bank of China silhouette. */}
      <path d="M-14 280h42v87h-42z" fill={fill('windows')} />
      <path d="M48 219h48v148H48zM53 213h38v6H53z" fill={fill('light-windows')} stroke="#7c7972" />
      <path d="M109 270h33v97h-33z" fill={fill('windows')} />
      <path
        d="M174 174h62v193h-62z"
        fill={fill('round-windows')}
        stroke="var(--ink)"
        strokeWidth="1.5"
      />
      <path d="M180 168h50v6h-50zM198 159h14v9h-14z" fill="#73716a" />
      <path
        d="M281 360V153l29-55 44 42v220Z"
        fill={fill('facade')}
        stroke="var(--ink)"
        strokeWidth="1.5"
      />
      <path
        d="M310 98v262M310 98l44 42M281 153l73 94-73 111M354 140l-73 109 73 111"
        stroke="#f0ede6"
        strokeWidth="2.4"
      />
      <path d="M310 98V59M331 118V73" stroke="var(--ink)" strokeWidth="2" />
      <path d="M354 140l11 6v214h-11z" fill={fill('hatch')} />
      <path d="M379 277h42v90h-42z" fill={fill('windows')} />

      {/* Old Hong Kong: the clock tower and a low, colonnaded waterfront. */}
      <g stroke="var(--ink)" strokeWidth="1.4">
        <path d="M456 360V261h34v99Z" fill="#d4d1c9" />
        <path d="M453 261v-8h40v8ZM460 253v-21h25v21Z" fill="#f1eee7" />
        <path d="M459 232q13-28 27 0ZM473 215v-12" fill="#77746d" />
        <circle cx="473" cy="243" r="6" fill="var(--paper)" />
        <path d="M473 239v4l3 2M463 267v79M470 267v79M478 267v79M485 267v79M451 349h43v11h-43" />
        <path
          d="M424 360v-17h90v17M430 347v13M440 347v13M450 347v13M500 347v13M510 347v13"
          fill="var(--paper)"
        />
      </g>
      <path d="M528 270h42v98h-42z" fill={fill('windows')} />
      <path d="M584 199h47v169h-47z" fill={fill('light-windows')} stroke="#625f59" />
      <path d="M592 191h31v8h-31zM606 182v9" stroke="var(--ink)" fill="#73716a" />

      {/* Structural cross-bracing and layered façades echo Central. */}
      <path d="M712 365V227h108v138Z" fill={fill('facade')} />
      <path d="M704 225h10v140h-10zM764 205h8v160h-8zM820 225h10v140h-10z" fill="#77746d" />
      <path
        d="M704 239h126M704 281h126M704 324h126M714 241l50 40-50 43 50 40M820 241l-48 40 48 43-48 40"
        stroke="#e5e2da"
        strokeWidth="3"
      />
      <path d="M702 222h130M710 217h112M768 205v-17" stroke="var(--ink)" strokeWidth="2" />
      <path d="M851 263h49v102h-49z" fill={fill('windows')} />

      {/* IFC: stepped crown, fine vertical fins, and a tapered silhouette. */}
      <path
        d="M996 362V118l8-48 10-26h41l10 26 8 48v244Z"
        fill="#c8c5bd"
        stroke="var(--ink)"
        strokeWidth="1.5"
      />
      <path d="M1006 362V111l8-46h41l8 46v251Z" fill={fill('facade')} />
      {[1012, 1023, 1034, 1045, 1056].map((x) => (
        <path key={x} d={`M${x} 80v282`} stroke="#ddd9d1" strokeWidth="1.5" />
      ))}
      <path
        d="M1015 44V28h6v16M1048 44V28h6v16M1002 104h65M998 127h74M998 157h74M998 187h74M998 217h74M998 247h74M998 277h74M998 307h74M998 337h74"
        stroke="#e4e0d8"
        strokeWidth="1.5"
      />
      <path d="M1090 290h47v76h-47z" fill={fill('light-windows')} stroke="#7d7972" />
      <path d="M1146 250h41v116h-41z" fill={fill('windows')} />
      <path
        d="M1233 361V135l12-21h56l9 21v226Z"
        fill={fill('facade')}
        stroke="var(--ink)"
        strokeWidth="1.5"
      />
      <path
        d="M1245 114v247M1257 119v242M1285 119v242M1298 114v247"
        stroke="#aaa69d"
        strokeWidth="2"
      />
      <path d="M1247 109h51v5h-51zM1267 99h11v10h-11z" fill="var(--ink)" />
      <path d="M1362 250h50v116h-50z" fill={fill('windows')} />
      <path d="M1424 205h38v161h-38z" fill={fill('light-windows')} />

      {/* Independent trams follow the illustrated route under a fine overhead wire. */}
      <g fill="#dad6cd" stroke="var(--ink)" strokeWidth="1.2">
        <path d="M848 325h14v76h-14zM1080 294h16v107h-16zM1330 258h17v143h-17z" />
        <path
          d="M852 326h5v75h-5zM1084 294h6v107h-6zM1334 258h7v143h-7z"
          fill={fill('hatch')}
          stroke="none"
        />
      </g>
      <g transform="translate(743 330) rotate(-8)">
        <path d="M-8 0h850v12H-8Z" fill="#dad6cd" stroke="var(--ink)" strokeWidth="1.3" />
        <path d="M-8 4h850M-8 8h850" stroke="#9a968c" />
        <path d="M-8-3h850" stroke="var(--ink)" strokeWidth="2.5" />
        <path d="M-8-142h850" stroke="var(--ink)" strokeWidth="0.8" opacity="0.55" />
        <path
          d="M320 0v-149m0 7h-14M720 0v-149m0 7h-14"
          stroke="var(--ink)"
          strokeWidth="1"
          opacity="0.6"
        />
        <g clipPath={fill('rail-clip')}>
          <g className="city-tram">
            <use href={ref('tram')} />
          </g>
          <g className="city-tram city-tram-secondary">
            <use href={ref('tram')} />
          </g>
          <g className="city-tram city-tram-tertiary">
            <use href={ref('tram')} />
          </g>
        </g>
      </g>

      {/* Street lamps, stippled trees and the harbour complete the ink foreground. */}
      <g stroke="var(--ink)" strokeWidth="2" strokeLinecap="round">
        <path d="M146 382V287q0-8 8-8h18M912 388V207q0-9 9-9h18M1377 387V174q0-8 8-8h15" />
        <path d="M159 280h16M926 199h16M1389 167h14" strokeWidth="4" />
      </g>
      {[
        [-5, 347, 0.83],
        [43, 355, 0.72],
        [109, 350, 0.87],
        [157, 363, 0.6],
        [245, 363, 0.65],
        [392, 359, 0.78],
        [549, 362, 0.7],
        [672, 341, 1.02],
        [718, 358, 0.73],
        [940, 350, 0.92],
        [1164, 362, 0.7],
        [1211, 359, 0.66],
        [1407, 349, 0.91],
      ].map(([x, y, scale], i) => (
        <use key={i} href={ref('tree')} transform={`translate(${x} ${y}) scale(${scale})`} />
      ))}
      <path d="M0 395h1440" stroke="#625f59" strokeWidth="1.5" />
      <path
        d="M173 402h120M190 408h51M379 401h177M427 407h93M767 403h104M794 409h46M1027 403h113M1265 405h67"
        stroke="#ada89d"
        strokeWidth="1"
      />
      <g transform="translate(568 385)" stroke="var(--ink)" strokeWidth="1.3">
        <path d="M0 0h67L58 9H9Z" fill="var(--ink)" />
        <path d="M10 0v-10h43l8 10Z" fill="#f1eee7" />
        <path d="M17-11v-7h31v7M33-18v-9M29-24h14" />
        <path d="M17-7h5M28-7h5M39-7h5M50-7h4" strokeWidth="4" />
      </g>
    </svg>
  );
}

export function CityHero({ user }: { user?: User }) {
  const t = useT();
  const scene = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changePreference = () => setReduced(preference.matches);
    let inView = true;
    const updateVisibility = () => setVisible(inView && document.visibilityState === 'visible');
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      updateVisibility();
    });
    if (scene.current) observer.observe(scene.current);
    preference.addEventListener('change', changePreference);
    document.addEventListener('visibilitychange', updateVisibility);
    updateVisibility();
    return () => {
      observer.disconnect();
      preference.removeEventListener('change', changePreference);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  return (
    <section className="city-hero" aria-labelledby="hero-heading">
      <div className="hero-copy container">
        <div className="eyebrow hero-eyebrow">
          <span className="dot" />
          {t('香港 · 你的下一站', 'HONG KONG · YOUR NEXT CHAPTER')}
        </div>
        <h1 id="hero-heading">
          {t('你的事業，', 'Your next chapter, ')}
          <em>{t('從香港出發。', 'starts here.')}</em>
        </h1>
        <p className="lead">
          {t(
            '從公司設立、首年秘書到註冊地址。讓 Norby 陪你辦好每一步，把心力留給你的下一個可能。',
            'Incorporation, company secretary, and a registered address. We take care of the first steps. You make room for what comes next.',
          )}
        </p>
        <div className="hero-actions">
          <a href={user ? '/cases' : '/sign-up'} className="button">
            {t('開始設立公司', 'Start your company')}
            <ArrowUpRight size={17} />
          </a>
          <a href="#process" className="button secondary">
            {t('了解辦理流程', 'Explore the process')}
            <ArrowDown size={16} />
          </a>
        </div>
        <p className="hero-note">
          {t(
            '專人審核，每一步都有跡可循。',
            'Human expertise. A clear path, every step of the way.',
          )}
        </p>
      </div>
      <div className="city-scene" ref={scene} data-paused={paused || reduced || !visible}>
        <CityIllustration />
      </div>
      <div className="hero-caption container">
        <span>
          22.3193° N &nbsp; 114.1694° E <span className="caption-divider">/</span> HONG KONG
        </span>
        <span className="hero-edition">01 — {t('新的起點', 'A NEW BEGINNING')}</span>
        <button
          className="motion-control"
          type="button"
          hidden={reduced}
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? t('播放動畫', 'Play animation') : t('暫停動畫', 'Pause animation')}
        </button>
      </div>
    </section>
  );
}
