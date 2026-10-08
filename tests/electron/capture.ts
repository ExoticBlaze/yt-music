import { writeFile } from 'node:fs/promises';
import type { WebContents, BrowserWindow } from 'electron';

export async function captureScreenshot(
  contents: WebContents | BrowserWindow,
  path: string,
): Promise<void> {
  try {
    const screenshot = await contents.capturePage(undefined, { stayAwake: true });
    await writeFile(path, screenshot.toPNG());
  } catch (error) {
    if (!/UnknownVizError|Current display surface not available/.test(String(error))) throw error;
    console.log(`CAPTURE_UNVERIFIED: ${path} (${String(error)})`);
  }
}
