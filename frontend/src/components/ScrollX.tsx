import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";

interface ScrollXProps {
  children: ReactNode;
  /** Classes for the viewport — the element that actually does the scrolling. */
  className?: string;
  /** Where the rail pins as the page scrolls past it. Any CSS length. */
  stickyTop?: string;
  /** What the rail scrolls, for anyone who meets it without seeing it. */
  label?: string;
}

/** Below this a thumb is too small to grab, so it stops shrinking. */
const MIN_THUMB = 34;
/** One arrow-key press. */
const STEP = 60;

/**
 * A sideways-scrolling region with a scrollbar above it as well as below.
 *
 * A wide table's own scrollbar sits under its last row, so on a fifty-row list
 * you have to leave the rows you are reading to reach it — and in a narrow
 * window, where the table overflows most, that walk is longest. This adds a
 * second scrollbar above the region and pins it below the topbar, so the
 * control is wherever you happen to be looking. The region keeps its own
 * scrollbars; this is one more way in, not a replacement.
 *
 * The thumb is drawn rather than borrowed from the platform. A native scrollbar
 * is an overlay on macOS and on every trackpad — it fades out when it is not
 * being used, which is the one thing a control that exists to be findable
 * cannot do.
 *
 * The rail appears only while the content really is wider than its viewport, at
 * any window size: a scrollbar for content that already fits is a control that
 * does nothing.
 */
export function ScrollX({
  children,
  className = "",
  stickyTop,
  label = "Scroll sideways",
}: ScrollXProps) {
  const viewRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [dragging, setDragging] = useState(false);
  const viewId = useId();

  /**
   * Size and place the thumb from the viewport's own numbers.
   *
   * Written straight to the DOM rather than held in state: this runs on every
   * scroll event, and a re-render per frame to move one element would be paid
   * by everything inside the region.
   */
  const layout = useCallback(() => {
    const view = viewRef.current;
    const track = trackRef.current;
    if (!view) return;
    // A sub-pixel difference is rounding, not overflow.
    const hidden = view.scrollWidth - view.clientWidth;
    setOverflows(hidden > 1);
    if (!track || !thumbRef.current || hidden <= 1) return;

    const trackWidth = track.clientWidth;
    const thumbWidth = Math.max(
      MIN_THUMB,
      Math.round((view.clientWidth / view.scrollWidth) * trackWidth)
    );
    const travel = Math.max(0, trackWidth - thumbWidth);
    const offset = travel > 0 ? (view.scrollLeft / hidden) * travel : 0;

    thumbRef.current.style.width = `${thumbWidth}px`;
    thumbRef.current.style.transform = `translateX(${offset}px)`;
    track.setAttribute(
      "aria-valuenow",
      String(Math.round((view.scrollLeft / hidden) * 100))
    );
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    layout();
    const ro = new ResizeObserver(layout);
    // The viewport catches the window, the sidebar and split view; the content
    // catches added columns and late-loading fonts, neither of which changes
    // the viewport's own size.
    ro.observe(view);
    if (view.firstElementChild) ro.observe(view.firstElementChild);
    return () => ro.disconnect();
  }, [children, layout]);

  // The rail mounts only once there is overflow, so its first measurement has
  // to happen after that — otherwise the thumb has no width until you scroll.
  useEffect(layout, [overflows, layout]);

  /** Move the viewport; its scroll event puts the thumb where it lands. */
  const scrollTo = (left: number) => {
    if (viewRef.current) viewRef.current.scrollLeft = left;
  };

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!view || !track || !thumb) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startLeft = view.scrollLeft;
    const hidden = view.scrollWidth - view.clientWidth;
    const travel = track.clientWidth - thumb.offsetWidth;
    if (travel <= 0) return;

    thumb.setPointerCapture(e.pointerId);
    setDragging(true);

    const move = (ev: PointerEvent) => {
      // The thumb crosses `travel` pixels while the content crosses `hidden`,
      // so a pixel of drag is worth more than a pixel of content.
      scrollTo(startLeft + ((ev.clientX - startX) / travel) * hidden);
    };
    const stop = (ev: PointerEvent) => {
      thumb.releasePointerCapture(ev.pointerId);
      thumb.removeEventListener("pointermove", move);
      thumb.removeEventListener("pointerup", stop);
      thumb.removeEventListener("pointercancel", stop);
      setDragging(false);
    };
    thumb.addEventListener("pointermove", move);
    thumb.addEventListener("pointerup", stop);
    thumb.addEventListener("pointercancel", stop);
  };

  /** A press on the bare track jumps the thumb to meet the pointer. */
  const jump = (e: ReactPointerEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!view || !track || !thumb || e.target === thumb) return;
    const travel = track.clientWidth - thumb.offsetWidth;
    if (travel <= 0) return;
    const hidden = view.scrollWidth - view.clientWidth;
    const wanted = e.clientX - track.getBoundingClientRect().left - thumb.offsetWidth / 2;
    scrollTo((Math.min(Math.max(wanted, 0), travel) / travel) * hidden);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    if (!view) return;
    const page = view.clientWidth * 0.9;
    const to: Record<string, number> = {
      ArrowLeft: view.scrollLeft - STEP,
      ArrowRight: view.scrollLeft + STEP,
      PageUp: view.scrollLeft - page,
      PageDown: view.scrollLeft + page,
      Home: 0,
      End: view.scrollWidth,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    scrollTo(to[e.key]);
  };

  /**
   * A sideways trackpad swipe over the rail scrolls it, as it would over the
   * rows. Vertical is left alone so the page still scrolls under it.
   */
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!e.deltaX) return;
    scrollTo((viewRef.current?.scrollLeft ?? 0) + e.deltaX);
  };

  return (
    <div className="hscroll">
      {overflows && (
        <div
          className={`hscroll-rail ${dragging ? "is-dragging" : ""}`.trim()}
          ref={trackRef}
          style={stickyTop ? { top: stickyTop } : undefined}
          onPointerDown={jump}
          onKeyDown={onKeyDown}
          onWheel={onWheel}
          role="scrollbar"
          aria-label={label}
          aria-controls={viewId}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          tabIndex={0}
        >
          <div className="hscroll-thumb" ref={thumbRef} onPointerDown={startDrag} />
        </div>
      )}
      <div
        className={`hscroll-view ${className}`.trim()}
        id={viewId}
        ref={viewRef}
        onScroll={layout}
      >
        {children}
      </div>
    </div>
  );
}
