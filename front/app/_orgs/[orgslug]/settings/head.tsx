import { createStitches } from '@stitches/react';

export const { getCssText } = createStitches();

export default function Head() {
    return (
      <>
        <title>Settings</title>
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <link rel="icon" href="/favicon.ico" />
        <style id="stitches" dangerouslySetInnerHTML={{ __html: getCssText() }} />
      </>
    )
  }
  