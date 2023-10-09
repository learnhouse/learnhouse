import Image from 'next/image';
import { ImageResponse } from 'next/server';
import logo from '@images/learnhouse_icon.png'
// App router includes @vercel/og.
// No need to install it.

export const runtime = 'edge';

export async function GET() {
  const fontData = await fetch(
    new URL('../../assets/fonts/INTER.TTF', import.meta.url),
  ).then((res) => res.arrayBuffer());

  // check if the font is getting loaded
  console.log(fontData);

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter',
          backgroundColor: 'white',
        }}
      >
        <div tw='flex w-[1200px] h-[630px] bg-white '>
          <div tw='flex flex-col mx-auto pt-[60px]'>
            <div tw='background-image w-[1100px] h-[400px] rounded-2xl shadow-2xl bg-center' style={{ backgroundPosition: 'center', backgroundSize:'100%', backgroundImage: "url('https://images.unsplash.com/photo-1696758011732-8ea3baae2791?')" }}>
            </div>
            <div tw='flex pt-5'>
              <div tw='flex grow flex-col -space-y-5 tracking-tighter'>
                <div tw='text-neutral-600 text-[30px]' style={{ fontWeight: 'bold' }}>Course</div>
                <div tw='text-neutral-900 text-[60px]' style={{ paddingTop:'0px', fontWeight: 'bold' }}>Course title</div>
              </div>
              <div tw='flex flex-col items-center justify-center'>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      // This crashes the page, not sure why yet.
      // refs : https://github.com/vercel/satori/issues/162, 
      // fonts: [
      //   {
      //     name: 'Typewriter',
      //     data: fontData,
      //     style: 'normal',
      //   },
      // ],
    },
  );
}