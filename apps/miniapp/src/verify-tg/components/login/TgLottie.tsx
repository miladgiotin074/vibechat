import { useEffect, useRef } from "react";

type Animation = {
  destroy: () => void;
  playSegments: (segments: [number, number], force: boolean) => void;
  addEventListener: (name: string, callback: () => void) => void;
};

/** Plays a raw Lottie file from the Telegram Android res/raw resources. */
export function TgLottie({
  name,
  size,
  loop = true,
  endFrame,
  className = "",
}: {
  name: string;
  size: number;
  loop?: boolean;
  endFrame?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let destroyed = false;
    let animation: Animation | undefined;

    void (async () => {
      const [{ default: lottie }, data] = await Promise.all([
        import("lottie-web"),
        fetch(`/tg/${name}.json`).then((response) => response.json()),
      ]);
      if (destroyed) return;
      animation = lottie.loadAnimation({
        container,
        renderer: "svg",
        loop: endFrame == null && loop,
        autoplay: endFrame == null,
        animationData: data,
      }) as Animation;
      if (endFrame != null) {
        animation.playSegments([0, endFrame], true);
      }
    })();

    return () => {
      destroyed = true;
      animation?.destroy();
    };
  }, [endFrame, loop, name]);

  return <div ref={ref} className={className} style={{ width: size, height: size }} aria-hidden />;
}
