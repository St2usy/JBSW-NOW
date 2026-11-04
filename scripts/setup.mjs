#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

function run(cmd, options = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...options });
}

async function main() {
  const projectRoot = process.cwd();

  // 1) Lock 파일 정리 (npm 사용 고정)
  for (const lock of ['pnpm-lock.yaml', 'yarn.lock']) {
    const p = path.join(projectRoot, lock);
    if (existsSync(p)) {
      await fs.rm(p, { force: true });
      console.log(`Removed ${lock}`);
    }
  }

  // 2) 의존성 설치 (lock이 있으면 ci, 없으면 install)
  if (existsSync(path.join(projectRoot, 'package-lock.json'))) {
    run('npm ci');
  } else {
    run('npm install');
  }

  // 3) .env 생성 (없으면) 및 누락된 환경 변수 키 추가
  const envPath = path.join(projectRoot, '.env');
  const envTemplate = `# App
EXPO_PUBLIC_API_BASE_URL=
EXPO_PUBLIC_PROXY_URL=http://localhost:8080
EXPO_PUBLIC_OLLAMA_URL=http://localhost:11434
EXPO_PUBLIC_OLLAMA_MODEL=llama3.1:8b
EXPO_PUBLIC_IMAGE_PROXY=http://localhost:4001/proxy?url={url}

# Firebase Configuration (required for authentication)
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_DATABASE_URL=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID=

# Auth (Google)
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=

# Gemini (client + scripts)
EXPO_PUBLIC_GEMINI_API_KEY=

# Ollama proxy (server/proxy.js)
PORT=8080
OLLAMA_URL=http://localhost:11434
MAX_CONCURRENT_REQUESTS=10

# Image proxy (server/imageProxy.js)
IMAGE_PROXY_PORT=4001
`;

  function parseEnvKeys(content) {
    const keys = new Set();
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      keys.add(trimmed.split('=', 1)[0].trim());
    }
    return keys;
  }

  if (!existsSync(envPath)) {
    await fs.writeFile(envPath, envTemplate, 'utf8');
    console.log('Created .env from full environment template');
  } else {
    try {
      const envContent = await fs.readFile(envPath, 'utf8');
      const present = parseEnvKeys(envContent);
      const linesToAdd = [];
      let pendingComment = null;

      for (const raw of envTemplate.trim().split('\n')) {
        if (!raw.trim()) {
          if (linesToAdd.length > 0 && linesToAdd[linesToAdd.length - 1] !== '') {
            linesToAdd.push('');
          }
          continue;
        }
        if (raw.startsWith('#')) {
          pendingComment = raw;
          continue;
        }
        const key = raw.split('=', 1)[0].trim();
        if (present.has(key)) {
          pendingComment = null;
          continue;
        }
        if (pendingComment) {
          if (linesToAdd.length > 0 && linesToAdd[linesToAdd.length - 1] !== '') {
            linesToAdd.push('');
          }
          linesToAdd.push(pendingComment);
          pendingComment = null;
        }
        linesToAdd.push(raw);
        present.add(key);
      }

      if (linesToAdd.length > 0) {
        const suffix = '\n' + linesToAdd.join('\n').replace(/\n+$/, '') + '\n';
        await fs.appendFile(envPath, envContent.endsWith('\n') ? suffix : '\n' + suffix, 'utf8');
        console.log(`Added missing env keys to .env: ${linesToAdd.filter((l) => l.includes('=')).map((l) => l.split('=')[0]).join(', ')}`);
      } else {
        console.log('.env already has all expected keys');
      }
    } catch (e) {
      console.warn('Failed to check/update .env:', e?.message || e);
    }
  }

  // 4) express 의존성 보증 설치 (누락 시 추가)
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkgRaw = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgRaw);
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const needExpress = !allDeps['express'];
    const needTypesExpress = !allDeps['@types/express'];
    const toInstall = [];
    if (needExpress) toInstall.push('express@^5.1.0');
    if (needTypesExpress) toInstall.push('@types/express@^4.17.21');
    if (toInstall.length > 0) {
      run(`npm install ${toInstall.join(' ')}`);
    }
  } catch (e) {
    console.warn('Failed to verify/install express deps:', e?.message || e);
  }

  // 4-1) react-native-svg 의존성 보증 설치 (누락 시 추가)
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkgRaw = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgRaw);
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const needReactNativeSvg = !allDeps['react-native-svg'];
    if (needReactNativeSvg) {
      run('npm install react-native-svg');
    }
  } catch (e) {
    console.warn('Failed to verify/install react-native-svg:', e?.message || e);
  }

  // 4-2) Firebase 의존성 보증 설치 (인증 기능에 필요)
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkgRaw = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgRaw);
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const needFirebase = !allDeps['firebase'];
    if (needFirebase) {
      console.log('\n📦 Installing firebase (required for authentication)...');
      run('npm install firebase@^12.3.0');
      console.log('✅ Firebase installed successfully');
    }
  } catch (e) {
    console.warn('Failed to verify/install firebase:', e?.message || e);
  }

  // 4-3) babel.config.js에서 react-native-reanimated 플러그인 확인
  try {
    const babelPath = path.join(projectRoot, 'babel.config.js');
    if (existsSync(babelPath)) {
      const babelContent = await fs.readFile(babelPath, 'utf8');
      if (!babelContent.includes('react-native-reanimated/plugin')) {
        console.warn('⚠️  react-native-reanimated/plugin not found in babel.config.js');
        console.warn('   Make sure it is the last plugin in the plugins array');
      } else {
        console.log('✅ react-native-reanimated plugin configured correctly');
      }
    }
  } catch (e) {
    console.warn('Failed to verify babel.config.js:', e?.message || e);
  }

  // 5) Watchman 설치 및 재인덱싱 (macOS)
  const isMac = process.platform === 'darwin';
  if (isMac) {
    const hasWatchman = spawnSync('which', ['watchman']).status === 0;
    if (!hasWatchman) {
      // Watchman이 없으면 Homebrew로 설치 시도
      const hasBrew = spawnSync('which', ['brew']).status === 0;
      if (hasBrew) {
        try {
          console.log('\n📦 Installing watchman (for file watching optimization)...');
          run('brew install watchman');
          console.log('✅ Watchman installed successfully');
        } catch (e) {
          console.warn('⚠️  Failed to install watchman:', e?.message || e);
          console.warn('   You can install it manually: brew install watchman');
        }
      } else {
        console.warn('⚠️  Watchman not found. Install Homebrew first, then run: brew install watchman');
      }
    } else {
      // Watchman이 있으면 재인덱싱
      try {
        const parent = path.dirname(projectRoot);
        run(`watchman watch-del '${parent}' || true`);
        run(`watchman watch-project '${parent}'`);
        console.log('✅ Watchman reindexed');
      } catch (e) {
        console.warn('⚠️  Failed to reindex watchman:', e?.message || e);
      }
    }
  }

  
  // 6) expo-doctor로 상태 점검 (있으면 진행)
  try {
    run('npx --yes expo-doctor');
  } catch {
    console.warn('\nexpo-doctor reported issues. You can rerun it later.');
  }

  console.log('\n✅ Setup complete. Next:');
  console.log('- Copy env template if needed: cp .env.example .env');
  console.log('- Fill in credentials in .env (Firebase, Gemini, Google OAuth, etc.)');
  console.log('- Start Ollama proxy: npm run proxy');
  console.log('- Start image proxy: npm run proxylocal');
  console.log('- Start dev server: npm run start');
  console.log('- iOS: npx expo run:ios');
  console.log('- Android: npx expo run:android');
  console.log('\n📝 Note: Authentication is required for all pages except /auth/login and /auth/signup');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

