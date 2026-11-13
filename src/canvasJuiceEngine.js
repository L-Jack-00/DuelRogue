/**
 * @file canvasJuiceEngine.js
 * @description [LJack Game Protocol v1.4.0] 전용 60FPS Canvas 2D 주스(Juice) & 물리 FX 엔진
 * DOM/CSS 연출의 한계를 극복하고 상용 인디 게임급 퀄리티의 타격감과 비주얼을 전담합니다.
 * 
 * 핵심 기둥:
 *  1. 역경직 (Hitstop / 3~4프레임 프리즈 프레임)
 *  2. 캔버스 발광 가산 합성 (Additive Glow - globalCompositeOperation = 'lighter')
 *  3. 물리 기반 크리스탈 산산조각 파편 (Glass Shatter Physics with Gravity & Rotation)
 *  4. 3차 베지에 곡선 리본 트레일 영혼 궤적 (Ethereal Soul Wisp with Tangent Banking)
 *  5. Ease-In 가속도 플라즈마 관통 볼트 & 코멧 테일 (Piercing Energy Bolt)
 *  6. 펄스 3색 대상 오라 & 스프링 부유 텍스트
 */

export class CanvasJuiceEngine {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.isRunning = false;
    this.lastTime = performance.now();

    // 역경직 (Hitstop) 타이머
    this.hitstopRemaining = 0;

    // 활성 이펙트 풀
    this.shards = [];
    this.shockwaves = [];
    this.soulWisps = [];
    this.piercingBolts = [];
    this.floatingTexts = [];
    this.impactSparks = [];
    // 플레이어 본체 피격 특화 먼지 풀 (LJack Dust Dispersion)
    this.dustPuffs = [];
    this.dustRings = [];

    // 대상 카드 오라
    this.activeAuras = []; // { rect, color: 'GREEN' | 'YELLOW' | 'RED' }
    this.auraPhase = 0;

    // 카메라 쉐이크 물리 상태 (LJack Pillar 5: Decay Screen Shake)
    this.shakePower = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    this.shakeRot = 0;
    this.wasShaking = false;
    this.appContainer = null;

    // 튜너 설정 연동
    this.settings = {
      shakeMult: 1.0,
      slamSpeed: 1.0,
      shatterShards: 18,
      pierceSpeed: 1.0,
      hitstopMs: 50,
    };
  }

  init(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.start();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = 1280 * dpr;
    this.canvas.height = 800 * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  stop() {
    this.isRunning = false;
    this.shakePower = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    this.shakeRot = 0;
    this.applyScreenShakeToDom(0, 0, 0);
  }

  applyScreenShakeToDom(x, y, rot) {
    if (!this.appContainer) {
      this.appContainer = document.getElementById('game-app');
    }
    if (this.appContainer) {
      this.appContainer.style.setProperty('--screen-shake-x', `${x.toFixed(2)}px`);
      this.appContainer.style.setProperty('--screen-shake-y', `${y.toFixed(2)}px`);
      this.appContainer.style.setProperty('--screen-shake-rot', `${rot.toFixed(2)}deg`);
    }
  }

  updateTuner(settings) {
    this.settings = { ...this.settings, ...settings };
  }

  // ============================================================================
  // 메인 게임 루프 (Fixed 60Hz Delta Timing)
  // ============================================================================
  loop(currentTime) {
    if (!this.isRunning) return;
    const rawDt = (currentTime - this.lastTime) / 1000;
    const dt = Math.min(0.1, Math.max(0.001, rawDt));
    this.lastTime = currentTime;

    // 역경직(Hitstop) 판정: 활성화 시 프레임을 잠시 정지시킴
    if (this.hitstopRemaining > 0) {
      this.hitstopRemaining -= rawDt * 1000;
      // 역경직 중에는 파티클 이동을 멈추고 렌더링만 갱신
      this.render();
      requestAnimationFrame((t) => this.loop(t));
      return;
    }

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    this.auraPhase += dt * 3.5;

    // 1. 카메라 쉐이크 감쇠 (LJack Pillar 5: Decay Screen Shake)
    if (this.shakePower > 0) {
      this.shakePower = Math.max(0, this.shakePower - dt * 38);
      const angle = Math.random() * Math.PI * 2;
      // 피격 강도 제곱 커브 (Trauma-squared) - 초반에 찰진 충격을 주고 부드럽게 감쇠
      const traumaNorm = Math.min(1.0, this.shakePower / 25.0);
      const traumaSq = traumaNorm * traumaNorm;
      const mag = traumaSq * 18 * (this.settings.shakeMult ?? 1.0);

      this.shakeOffsetX = Math.cos(angle) * mag;
      this.shakeOffsetY = Math.sin(angle) * mag;
      this.shakeRot = (Math.random() - 0.5) * (traumaSq * 2.2 * (this.settings.shakeMult ?? 1.0));
      this.applyScreenShakeToDom(this.shakeOffsetX, this.shakeOffsetY, this.shakeRot);
      this.wasShaking = true;
    } else if (this.wasShaking) {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
      this.shakeRot = 0;
      this.applyScreenShakeToDom(0, 0, 0);
      this.wasShaking = false;
    }

    // 2. 크리스탈 산산조각 파편 업데이트
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += s.gravity * dt; // 중력 가속도
      s.rotation += s.vRot * dt;
      s.life -= dt;
      s.alpha = Math.max(0, s.life / s.maxLife);
      if (s.life <= 0) {
        this.shards.splice(i, 1);
      }
    }

    // 3. 충격파 링 업데이트
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += sw.speed * dt;
      sw.life -= dt;
      sw.alpha = Math.max(0, sw.life / sw.maxLife);
      if (sw.life <= 0) {
        this.shockwaves.splice(i, 1);
      }
    }

    // 4. 스파크 파티클 업데이트
    for (let i = this.impactSparks.length - 1; i >= 0; i--) {
      const sp = this.impactSparks[i];
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.vx *= 0.94;
      sp.vy *= 0.94;
      sp.life -= dt;
      sp.alpha = Math.max(0, sp.life / sp.maxLife);
      if (sp.life <= 0) {
        this.impactSparks.splice(i, 1);
      }
    }

    // 5. 영혼의 형태 (Soul Wisp) 베지에 곡선 이동
    for (let i = this.soulWisps.length - 1; i >= 0; i--) {
      const wisp = this.soulWisps[i];
      wisp.progress += dt * wisp.speed;
      const t = Math.min(1, wisp.progress);

      // 2차 베지에 곡선 계산: P0(시작) -> P1(포물선 정점) -> P2(묘지)
      const u = 1 - t;
      const curX = u * u * wisp.p0.x + 2 * u * t * wisp.p1.x + t * t * wisp.p2.x;
      const curY = u * u * wisp.p0.y + 2 * u * t * wisp.p1.y + t * t * wisp.p2.y;

      // 트레일 히스토리 기록
      wisp.trail.unshift({ x: curX, y: curY, alpha: 1.0 });
      if (wisp.trail.length > 16) wisp.trail.pop();
      wisp.x = curX;
      wisp.y = curY;

      // 경로에 반짝이는 잔류 파티클 방출
      if (Math.random() < 0.6) {
        this.impactSparks.push({
          x: curX + (Math.random() - 0.5) * 8,
          y: curY + (Math.random() - 0.5) * 8,
          vx: (Math.random() - 0.5) * 20,
          vy: (Math.random() - 0.5) * 20,
          life: 0.35,
          maxLife: 0.35,
          alpha: 1,
          size: Math.random() * 3 + 1.5,
          color: '#38bdf8',
        });
      }

      if (t >= 1) {
        wisp.onArrive?.();
        this.spawnShockwave(wisp.p2.x, wisp.p2.y, 35, '#38bdf8');
        this.soulWisps.splice(i, 1);
      }
    }

    // 6. 관통 에너지 볼트 (Ease-In 가속 비행 & 코멧 테일)
    for (let i = this.piercingBolts.length - 1; i >= 0; i--) {
      const bolt = this.piercingBolts[i];
      // Ease-In 가속 공식: 시간이 지날수록 속도가 기하급수적으로 폭증
      bolt.elapsed += dt;
      const tLinear = Math.min(1, bolt.elapsed / bolt.duration);
      const tEaseIn = Math.pow(tLinear, 2.5); // 급격한 가속

      const curX = bolt.startX + (bolt.targetX - bolt.startX) * tEaseIn;
      const curY = bolt.startY + (bolt.targetY - bolt.startY) * tEaseIn;

      bolt.trail.unshift({ x: curX, y: curY });
      if (bolt.trail.length > 18) bolt.trail.pop();
      bolt.x = curX;
      bolt.y = curY;

      // 플라즈마 불꽃 방출
      this.impactSparks.push({
        x: curX + (Math.random() - 0.5) * 10,
        y: curY + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 40 - (bolt.targetX - bolt.startX) * 0.1,
        vy: (Math.random() - 0.5) * 40 - (bolt.targetY - bolt.startY) * 0.1,
        life: 0.28,
        maxLife: 0.28,
        alpha: 1,
        size: Math.random() * 4 + 2,
        color: '#ef4444',
      });

      if (tLinear >= 1) {
        bolt.onHit?.();
        this.spawnShockwave(bolt.targetX, bolt.targetY, 70, '#ef4444');
        this.spawnImpactStarburst(bolt.targetX, bolt.targetY, 35, '#ef4444');
        this.piercingBolts.splice(i, 1);
      }
    }

    // 7. 부유 데미지 텍스트 업데이트
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= dt * 45;
      ft.life -= dt;
      ft.scale = Math.min(1.4, ft.scale + dt * 2.2);
      ft.alpha = Math.max(0, ft.life / ft.maxLife);
      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }

    // 8. 플레이어 본체 피격 특화 먼지 털림 (Dust Puff & Ring) 물리 업데이트
    for (let i = this.dustPuffs.length - 1; i >= 0; i--) {
      const d = this.dustPuffs[i];
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      // 공기 저항 감속
      d.vx *= Math.pow(0.14, dt);
      d.vy *= Math.pow(0.14, dt);
      d.vy += d.buoyancy * dt;
      d.radius += d.expandSpeed * dt;
      d.rotation += d.vRot * dt;
      d.life -= dt;
      d.alpha = Math.max(0, Math.pow(d.life / d.maxLife, 1.25) * d.baseAlpha);
      if (d.life <= 0) {
        this.dustPuffs.splice(i, 1);
      }
    }

    for (let i = this.dustRings.length - 1; i >= 0; i--) {
      const ring = this.dustRings[i];
      ring.rx += ring.speed * dt;
      ring.ry += ring.speed * 0.45 * dt;
      ring.life -= dt;
      ring.alpha = Math.max(0, Math.pow(ring.life / ring.maxLife, 1.2) * ring.baseAlpha);
      if (ring.life <= 0) {
        this.dustRings.splice(i, 1);
      }
    }
  }

  // ============================================================================
  // 렌더링 파이프라인 (Additive Glowing Shaders)
  // ============================================================================
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 1280, 800);

    ctx.save();
    // 뷰포트 전체(#game-app)가 CSS translate3d/rotate로 흔들리므로
    // #game-fx-canvas도 함께 진동하여 ctx.translate 중복 없이 1:1 완벽 정렬됨.

    // 1. 대상 카드 오라 렌더링
    this.renderAuras(ctx);

    // 2. 가산 발광 합성 모드 활성화 (진짜 마법/빛 효과)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 2-1. 충격파 링 그리기
    this.renderShockwaves(ctx);

    // 2-2. 임팩트 스파크 그리기
    this.renderSparks(ctx);

    // 2-3. 영혼의 형태 (Soul Wisp) & 리본 트레일
    this.renderSoulWisps(ctx);

    // 2-4. 관통 에너지 볼트 & 코멧 테일
    this.renderPiercingBolts(ctx);

    ctx.restore(); // 기본 블렌드 복원

    // 3. 물리 유리 파편 그리기 (가산 합성 + 고유 텍스처)
    this.renderShards(ctx);

    // 4. 플레이어 본체 피격 특화 먼지 구름 및 지면 충격 분산 링 그리기
    this.renderDustPuffs(ctx);

    // 5. 부유 데미지 텍스트 그리기
    this.renderFloatingTexts(ctx);

    ctx.restore();
  }

  renderAuras(ctx) {
    if (!this.activeAuras.length) return;
    const pulse = (Math.sin(this.auraPhase) + 1) * 0.5; // 0 ~ 1

    this.activeAuras.forEach(({ rect, colorType }) => {
      let strokeColor = '#22c55e';
      let glowColor = 'rgba(34, 197, 94, 0.4)';
      if (colorType === 'YELLOW') {
        strokeColor = '#eab308';
        glowColor = 'rgba(234, 179, 8, 0.4)';
      } else if (colorType === 'RED') {
        strokeColor = '#ef4444';
        glowColor = 'rgba(239, 68, 68, 0.45)';
      }

      ctx.save();
      ctx.shadowColor = strokeColor;
      ctx.shadowBlur = 12 + pulse * 14;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 3 + pulse * 2;
      ctx.fillStyle = glowColor;

      // 둥근 사각 테두리
      const x = rect.left - 4;
      const y = rect.top - 4;
      const w = rect.width + 8;
      const h = rect.height + 8;
      const r = 8;

      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.stroke();
      ctx.fill();

      // 모서리 4방향 집중 광원 점
      ctx.fillStyle = '#ffffff';
      [
        { cx: x, cy: y },
        { cx: x + w, cy: y },
        { cx: x, cy: y + h },
        { cx: x + w, cy: y + h },
      ].forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.cx, pt.cy, 3 + pulse * 1.5, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();
    });
  }

  renderShockwaves(ctx) {
    this.shockwaves.forEach((sw) => {
      ctx.save();
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = Math.max(1, (1 - sw.radius / 160) * 6);
      ctx.globalAlpha = sw.alpha;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();

      // 안쪽 2차 링
      if (sw.radius > 15) {
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.radius * 0.65, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  renderSparks(ctx) {
    this.impactSparks.forEach((sp) => {
      ctx.save();
      ctx.globalAlpha = sp.alpha;
      ctx.fillStyle = sp.color;
      ctx.shadowColor = sp.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  renderShards(ctx) {
    this.shards.forEach((s) => {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rotation);
      ctx.globalAlpha = s.alpha;

      // 크리스탈 그라디언트 채우기
      const grad = ctx.createLinearGradient(-s.size, -s.size, s.size, s.size);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.4, s.tintColor);
      grad.addColorStop(1, '#0f172a');
      ctx.fillStyle = grad;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let p = 1; p < s.points.length; p++) {
        ctx.lineTo(s.points[p].x, s.points[p].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    });
  }

  renderSoulWisps(ctx) {
    this.soulWisps.forEach((wisp) => {
      // 1. 유기적인 리본 트레일
      if (wisp.trail.length > 2) {
        for (let i = 0; i < wisp.trail.length - 1; i++) {
          const pA = wisp.trail[i];
          const pB = wisp.trail[i + 1];
          const ratio = 1 - i / wisp.trail.length;

          ctx.save();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = ratio * 12;
          ctx.globalAlpha = ratio * 0.75;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(pA.x, pA.y);
          ctx.lineTo(pB.x, pB.y);
          ctx.stroke();

          // 내부 백색 광심
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = ratio * 4;
          ctx.globalAlpha = ratio * 0.95;
          ctx.beginPath();
          ctx.moveTo(pA.x, pA.y);
          ctx.lineTo(pB.x, pB.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 2. 발광 영혼 헤드 코어
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.arc(wisp.x, wisp.y, 8, 0, Math.PI * 2);
      ctx.fill();

      // 외부 오라
      ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.beginPath();
      ctx.arc(wisp.x, wisp.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  renderPiercingBolts(ctx) {
    this.piercingBolts.forEach((bolt) => {
      // 1. 플라즈마 코멧 테일
      if (bolt.trail.length > 2) {
        for (let i = 0; i < bolt.trail.length - 1; i++) {
          const pA = bolt.trail[i];
          const pB = bolt.trail[i + 1];
          const ratio = 1 - i / bolt.trail.length;

          ctx.save();
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = ratio * 16;
          ctx.globalAlpha = ratio * 0.8;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(pA.x, pA.y);
          ctx.lineTo(pB.x, pB.y);
          ctx.stroke();

          // 백색 열선 중심부
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = ratio * 5;
          ctx.globalAlpha = ratio * 0.95;
          ctx.beginPath();
          ctx.moveTo(pA.x, pA.y);
          ctx.lineTo(pB.x, pB.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 2. 볼트 헤드
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 28;
      ctx.beginPath();
      ctx.arc(bolt.x, bolt.y, 11, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
      ctx.beginPath();
      ctx.arc(bolt.x, bolt.y, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  renderFloatingTexts(ctx) {
    this.floatingTexts.forEach((ft) => {
      ctx.save();
      ctx.font = `900 ${Math.floor(ft.baseSize * ft.scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = ft.alpha;

      // 텍스트 외곽 그림자
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 4;
      ctx.strokeText(ft.text, ft.x, ft.y);

      // 본문 색상
      ctx.fillStyle = ft.color;
      ctx.shadowColor = ft.color;
      ctx.shadowBlur = 10;
      ctx.fillText(ft.text, ft.x, ft.y);

      ctx.restore();
    });
  }

  // 플레이어 본체 피격 특화 먼지 털림 & 바닥 충격파 분산 링 렌더러
  renderDustPuffs(ctx) {
    // 1. 바닥 타원형 분산 충격파 링 (Ground Shockwave Dust Rings)
    if (this.dustRings && this.dustRings.length > 0) {
      this.dustRings.forEach((ring) => {
        if (ring.alpha <= 0.01) return;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(ring.cx, ring.cy, Math.max(1, ring.rx), Math.max(1, ring.ry), 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(203, 213, 225, ${ring.alpha.toFixed(3)})`;
        ctx.lineWidth = Math.max(1, 3.5 * (ring.life / ring.maxLife));
        ctx.stroke();
        ctx.restore();
      });
    }

    // 2. 아바타 주변 뭉게구름 먼지 (Volumetric Dust Clouds)
    if (this.dustPuffs && this.dustPuffs.length > 0) {
      this.dustPuffs.forEach((d) => {
        if (d.alpha <= 0.01) return;
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rotation);

        // 방사형 그래디언트로 가장자리가 부드러운 먼지 구름 연출
        const grad = ctx.createRadialGradient(0, 0, d.radius * 0.15, 0, 0, Math.max(1, d.radius));
        grad.addColorStop(0, `rgba(${d.r}, ${d.g}, ${d.b}, ${d.alpha.toFixed(3)})`);
        grad.addColorStop(0.5, `rgba(${d.r}, ${d.g}, ${d.b}, ${(d.alpha * 0.6).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${d.r}, ${d.g}, ${d.b}, 0)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(1, d.radius), 0, Math.PI * 2);
        ctx.fill();

        // 내부 서브 퍼프 (먼지 덩어리 질감 텍스처)
        if (d.innerPuff) {
          ctx.fillStyle = `rgba(${Math.min(255, d.r + 20)}, ${Math.min(255, d.g + 20)}, ${Math.min(255, d.b + 20)}, ${(d.alpha * 0.45).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(d.innerOffsetX, d.innerOffsetY, Math.max(0.5, d.radius * 0.45), 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      });
    }
  }

  // ============================================================================
  // 퍼블릭 트리거 API
  // ============================================================================

  /**
   * 1. 찰나의 역경직 (Hitstop / Freeze Frame)
   */
  triggerHitstop(ms = 50) {
    this.hitstopRemaining = ms;
  }

  /**
   * 2. 카메라 쉐이크 트리거 (LJack Pillar 5: Decay Screen Shake)
   */
  triggerScreenShake(power = 10) {
    this.shakePower = Math.min(32, Math.max(this.shakePower, power));
    this.wasShaking = true;
  }

  /**
   * 3. 방사형 충격파 링 생성
   */
  spawnShockwave(x, y, radius = 50, color = '#ffffff') {
    this.shockwaves.push({
      x,
      y,
      radius: 4,
      maxRadius: radius,
      speed: (radius / 0.4) * this.settings.slamSpeed,
      color,
      alpha: 1.0,
      life: 0.4,
      maxLife: 0.4,
    });
  }

  /**
   * 4. 폭발 스파크 버스트 생성
   */
  spawnImpactStarburst(x, y, count = 25, color = '#facc15') {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = Math.random() * 260 + 90;
      this.impactSparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.35 + Math.random() * 0.2,
        maxLife: 0.5,
        alpha: 1,
        size: Math.random() * 4 + 2,
        color,
      });
    }
  }

  /**
   * 5. 카드 산산조각 파편 물리 생성 (Glass Shatter)
   */
  spawnCardShatter(cardRect, shardCount = 18) {
    const count = shardCount || this.settings.shatterShards;
    const centerX = cardRect.left + cardRect.width / 2;
    const centerY = cardRect.top + cardRect.height / 2;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = Math.random() * 280 + 120;
      const size = Math.random() * 12 + 8;

      // 날카로운 무작위 3각형/4각형 버텍스 생성
      const points = [
        { x: (Math.random() - 0.5) * size, y: -size },
        { x: size, y: (Math.random() - 0.5) * size },
        { x: (Math.random() - 0.5) * size, y: size },
        { x: -size, y: (Math.random() - 0.5) * size },
      ];

      this.shards.push({
        x: centerX + (Math.random() - 0.5) * (cardRect.width * 0.6),
        y: centerY + (Math.random() - 0.5) * (cardRect.height * 0.6),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 90, // 위로 살짝 튀어오름
        gravity: 480, // 중력
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 16,
        points,
        size,
        tintColor: i % 2 === 0 ? '#38bdf8' : '#f87171',
        life: 0.75 + Math.random() * 0.25,
        maxLife: 1.0,
        alpha: 1,
      });
    }

    this.spawnImpactStarburst(centerX, centerY, 30, '#ffffff');
  }

  /**
   * 6. 영혼의 형태 (Soul Wisp) 베지에 비행 개시
   */
  spawnSoulWisp(startRect, targetGraveyardRect, onArrive) {
    const p0 = {
      x: startRect.left + startRect.width / 2,
      y: startRect.top + startRect.height / 2,
    };
    const p2 = {
      x: targetGraveyardRect.left + targetGraveyardRect.width / 2,
      y: targetGraveyardRect.top + targetGraveyardRect.height / 2,
    };

    // 포물선 정점(P1): 중력 반대 방향으로 높게 솟구쳤다가 묘지로 하강
    const midX = (p0.x + p2.x) / 2;
    const peakY = Math.min(p0.y, p2.y) - 140;
    const p1 = { x: midX, y: peakY };

    this.soulWisps.push({
      p0,
      p1,
      p2,
      x: p0.x,
      y: p0.y,
      progress: 0,
      speed: 1.45,
      trail: [],
      onArrive,
    });
  }

  /**
   * 7. 관통 에너지 볼트 (Piercing Bolt) 가속 발사
   */
  spawnPiercingBolt(startRect, targetAvatarRect, damage, onHit) {
    const startX = startRect.left + startRect.width / 2;
    const startY = startRect.top + startRect.height / 2;
    const targetX = targetAvatarRect.left + targetAvatarRect.width / 2;
    const targetY = targetAvatarRect.top + targetAvatarRect.height / 2;

    const duration = Math.max(0.18, 0.38 / this.settings.pierceSpeed);

    this.piercingBolts.push({
      startX,
      startY,
      targetX,
      targetY,
      x: startX,
      y: startY,
      elapsed: 0,
      duration,
      damage,
      trail: [],
      onHit: () => {
        this.triggerHitstop(40);
        this.triggerScreenShake(damage * 1.8);
        this.showFloatingText(targetX, targetY - 20, `-${damage} [관통!]`, '#f87171', 26);
        this.spawnPlayerDustPuff(targetX, targetY, targetAvatarRect.width || 78, targetAvatarRect.height || 98, 22);
        onHit?.();
      },
    });
  }

  /**
   * 8. 부유 텍스트
   */
  showFloatingText(x, y, text, color = '#ffffff', baseSize = 22) {
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      baseSize,
      scale: 0.6,
      alpha: 1.0,
      life: 0.85,
      maxLife: 0.85,
    });
  }

  /**
   * 9. 플레이어 본체 피격 특화 먼지 털림 효과 (Player Avatar Dust Dispersion)
   * 몬스터 카드가 아닌 본체/영웅 타격 시 주변으로 털려나가는 입체적 흙먼지 연출
   */
  spawnPlayerDustPuff(cx, cy, width = 78, height = 78, count = 24) {
    const halfW = width / 2;
    const halfH = height / 2;

    const dustColors = [
      { r: 226, g: 232, b: 240 }, // 밝은 백색 분진
      { r: 203, g: 213, b: 225 }, // 안개 그레이
      { r: 148, g: 163, b: 184 }, // 슬레이트 흙먼지
      { r: 214, g: 211, b: 209 }, // 웜 그레이 흙먼지
      { r: 168, g: 162, b: 158 }, // 진회색 분진
    ];

    // 1. 아바타 외곽 및 받침대 주변 뭉게구름 먼지 (20~26개)
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const distRatio = 0.65 + Math.random() * 0.55;
      const spawnX = cx + Math.cos(angle) * halfW * distRatio;
      const spawnY = cy + Math.sin(angle) * halfH * distRatio;

      const isBottom = Math.sin(angle) > 0;
      const speed = (60 + Math.random() * 120) * (this.settings.slamSpeed ?? 1.0);
      const vx = Math.cos(angle) * speed * (isBottom ? 1.3 : 1.0);
      const vy = Math.sin(angle) * speed * (isBottom ? 0.75 : 1.1) + (isBottom ? 15 : -10);

      const color = dustColors[Math.floor(Math.random() * dustColors.length)];
      const maxLife = 0.5 + Math.random() * 0.35;

      this.dustPuffs.push({
        x: spawnX,
        y: spawnY,
        vx,
        vy,
        radius: 10 + Math.random() * 10,
        expandSpeed: 25 + Math.random() * 30,
        r: color.r,
        g: color.g,
        b: color.b,
        baseAlpha: 0.65 + Math.random() * 0.25,
        alpha: 0.8,
        life: maxLife,
        maxLife,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 2.5,
        buoyancy: isBottom ? 10 : -16,
        innerPuff: Math.random() < 0.65,
        innerOffsetX: (Math.random() - 0.5) * 5,
        innerOffsetY: (Math.random() - 0.5) * 5,
      });
    }

    // 2. 미세 비산 분진 (Airborne Dust Specks, 14개)
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 150;
      const color = dustColors[Math.floor(Math.random() * dustColors.length)];
      this.dustPuffs.push({
        x: cx + (Math.random() - 0.5) * halfW * 0.9,
        y: cy + (Math.random() - 0.5) * halfH * 0.9,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        radius: 2 + Math.random() * 2.5,
        expandSpeed: 3 + Math.random() * 5,
        r: color.r,
        g: color.g,
        b: color.b,
        baseAlpha: 0.85,
        alpha: 0.85,
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.4 + Math.random() * 0.3,
        rotation: 0,
        vRot: 0,
        buoyancy: -25,
        innerPuff: false,
      });
    }

    // 3. 바닥 수평 분산 충격파 링 (2겹)
    this.spawnDustRing(cx, cy + halfH * 0.85, width * 0.8, height * 0.4);
    this.spawnDustRing(cx, cy + halfH * 0.85, width * 1.1, height * 0.55);
  }

  /**
   * 10. 바닥 수평 타원형 분산 충격파 링
   */
  spawnDustRing(cx, cy, rx = 50, ry = 22) {
    this.dustRings.push({
      cx,
      cy,
      rx: rx * 0.35,
      ry: ry * 0.35,
      maxRx: rx * 1.6,
      maxRy: ry * 1.6,
      speed: (rx * 2.6) * (this.settings.slamSpeed ?? 1.0),
      baseAlpha: 0.65,
      alpha: 0.65,
      maxLife: 0.45,
      life: 0.45,
    });
  }

  /**
   * 11. 3색 대상 카드 오라 설정
   */
  setTargetAura(elements, colorType = 'RED') {
    if (!elements || !elements.length) {
      this.activeAuras = [];
      return;
    }
    const canvasRect = this.canvas.getBoundingClientRect();
    this.activeAuras = Array.from(elements)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          rect: {
            left: r.left - canvasRect.left,
            top: r.top - canvasRect.top,
            width: r.width,
            height: r.height,
          },
          colorType,
        };
      })
      .filter((a) => a.rect.width > 0 && a.rect.height > 0);
  }

  clearTargetAura() {
    this.activeAuras = [];
  }
}
