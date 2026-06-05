import {
  Controller,
  Get,
  Header,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream, existsSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { Public } from '../auth/auth.guard';

const AAR_VERSION = '0.0.1';
// 发布产物固定放在 packages/mobile-sdk/dist/android/ 下；
// 找不到再回落到 Gradle 的 build outputs（开发期未拷贝时）。
const AAR_CANDIDATES = [
  `packages/mobile-sdk/dist/android/kintsugi-${AAR_VERSION}.aar`,
  'packages/mobile-sdk/android/kintsugi/build/outputs/aar/kintsugi-release.aar',
];

function resolveAarPath(): string | null {
  if (process.env['KINTSUGI_ANDROID_AAR_PATH']) {
    const p = process.env['KINTSUGI_ANDROID_AAR_PATH'];
    return existsSync(p) ? p : null;
  }
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    for (const rel of AAR_CANDIDATES) {
      const candidate = path.join(dir, rel);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

@Public()
@Controller('sdk')
export class SdkDownloadController {
  @Get('android/info')
  androidInfo(): {
    available: boolean;
    version: string;
    sizeBytes: number | null;
    filename: string;
    artifactId: string;
    groupId: string;
    minSdk: number;
    compileSdk: number;
  } {
    const p = resolveAarPath();
    return {
      available: !!p,
      version: AAR_VERSION,
      sizeBytes: p ? statSync(p).size : null,
      filename: 'kintsugi-release.aar',
      artifactId: 'kintsugi',
      groupId: 'com.kintsugi',
      minSdk: 24,
      compileSdk: 36,
    };
  }

  @Get('android/kintsugi.aar')
  @Header('Content-Type', 'application/vnd.android.package-archive')
  @Header('Cache-Control', 'public, max-age=300')
  downloadAndroid(): StreamableFile {
    const p = resolveAarPath();
    if (!p) {
      throw new NotFoundException(
        'AAR 未构建。请在 packages/mobile-sdk/android 下执行 `./gradlew :kintsugi:assembleRelease`，或将 AAR 放到 packages/mobile-sdk/dist/android/ 下。',
      );
    }
    const stat = statSync(p);
    return new StreamableFile(createReadStream(p), {
      type: 'application/vnd.android.package-archive',
      disposition: `attachment; filename="kintsugi-${AAR_VERSION}.aar"`,
      length: stat.size,
    });
  }
}
