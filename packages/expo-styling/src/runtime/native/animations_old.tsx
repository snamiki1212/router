import { AnimationIterationCount, EasingFunction, Time } from "lightningcss";
import React, { ComponentType, useState, useMemo, forwardRef } from "react";
import { View, Text } from "react-native";
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { exhaustiveCheck } from "../../css-to-rn/utils";
import {
  ContainerRuntime,
  ExtractedAnimation,
  Interaction,
  InteropMeta,
  Style,
  StyleProp,
} from "../../types";
import { flattenStyle, FlattenStyleOptions } from "./flattenStyle";
import { animationMap, styleMetaMap } from "./globals";

const defaultAnimation: ExtractedAnimation = { frames: [] };

type AnimationInteropProps = Record<string, unknown> & {
  __component: ComponentType<any>;
  __interaction: Interaction;
  __variables: Record<string, unknown>;
  __containers: Record<string, ContainerRuntime>;
  __interopMeta: InteropMeta;
};

/*
 * This component breaks the rules of hooks, however is it safe to do so as the animatedProps are static
 * If they do change, the key for this component will be regenerated forcing a remount (a reset of hooks)
 */
export const AnimationInterop = forwardRef(function Animated(
  {
    __component: Component,
    __propEntries,
    __interaction,
    __variables,
    __containers,
    __interopMeta: interopMeta,
    ...props
  }: AnimationInteropProps,
  ref: unknown
) {
  Component = createAnimatedComponent(Component);

  /* eslint-disable react-hooks/rules-of-hooks */
  for (const prop of new Set([
    ...interopMeta.transitionProps,
    ...interopMeta.animatedProps,
  ])) {
    const value = props[prop] as Style;

    if (
      interopMeta.transitionProps.has(prop) &&
      interopMeta.animatedProps.has(prop)
    ) {
      props[prop] = [
        value,
        useTransitions(value),
        useAnimations(value, {
          variables: __variables,
          interaction: __interaction,
          containers: __containers,
        }),
      ];
    } else if (interopMeta.transitionProps.has(prop)) {
      props[prop] = [value, useTransitions(value)];
    } else {
      props[prop] = [
        value,
        useAnimations(value, {
          variables: __variables,
          interaction: __interaction,
          containers: __containers,
        }),
      ];
    }
  }
  /* eslint-enable react-hooks/rules-of-hooks */

  return <Component ref={ref} {...props} />;
});

const animatedCache = new WeakMap<ComponentType<any>, ComponentType<any>>([
  [View, Animated.View],
  [Animated.View, Animated.View],
  [Text, Animated.Text],
  [Animated.Text, Animated.Text],
  [Text, Animated.Text],
]);

function createAnimatedComponent(
  Component: ComponentType<any>
): ComponentType<any> {
  if (animatedCache.has(Component)) {
    return animatedCache.get(Component)!;
  } else if (Component.displayName?.startsWith("AnimatedComponent")) {
    return Component;
  }

  if (
    !(
      typeof Component !== "function" ||
      (Component.prototype && Component.prototype.isReactComponent)
    )
  ) {
    throw new Error(
      `Looks like you're passing an animation style to a function component \`${Component.name}\`. Please wrap your function component with \`React.forwardRef()\` or use a class component instead.`
    );
  }

  const AnimatedComponent = Animated.createAnimatedComponent(
    Component as React.ComponentClass
  );

  animatedCache.set(Component, AnimatedComponent);

  return AnimatedComponent;
}

function useAnimations(style: Style, options: FlattenStyleOptions): StyleProp {
  const styleMetadata = styleMetaMap.get(style);
  const animations = styleMetadata?.animations ?? { name: [] };
  const names = animations.name!;

  // if (!animations || !names) {
  //   return style;
  // }

  const $style: Style[] = [];

  /* eslint-disable react-hooks/rules-of-hooks */
  for (let index = 0; index < names.length; index++) {
    const name = getValue(names, index, { type: "none" });

    if (!name || name.type === "none") {
      continue;
    }

    const flattenStyleOptions = {
      ...options,
      ch: typeof style.height === "number" ? style.height : undefined,
      cw: typeof style.width === "number" ? style.width : undefined,
    };

    const progress = useSharedValue(0);
    const keyframes = (
      animationMap.get(name.value) ?? defaultAnimation
    ).frames.map((frame) => ({
      ...frame,
      style: flattenStyle(frame.style, flattenStyleOptions),
    }));

    const iterationCount = countToInteger(
      getValue(animations.iterationCount, index, {
        type: "number",
        value: 1,
      })
    );

    const timingFrames = useMemo(() => {
      const getValue = <T extends any>(
        array: T[] | undefined,
        index: number,
        defaultValue: T
      ) => (array ? array[index % array.length] : defaultValue);
      const fillMode = getValue(animations.fillMode, index, "none");
      const direction = getValue(animations.direction, index, "normal");
      const duration = timeToMS(
        getValue(animations.duration, index, { type: "seconds", value: 0 })
      );

      const timingFunction = timingToEasing(
        getValue(animations.timingFunction, index, { type: "linear" })
      );

      for (let index = 1; index < keyframes.length; index++) {
        const from = keyframes[index - 1];
        const to = keyframes[index];
        // timingFrames.push(
        //   withTiming(index, {
        //     duration: 5000, //duration * (to.selector - from.selector),
        //     easing: Easing.linear,
        //   })
        // );
      }

      switch (direction) {
        case "normal":
        case "reverse":
        case "alternate":
        case "alternate-reverse":
          break;
      }

      switch (fillMode) {
        case "none":
        case "backwards":
        case "forwards":
        case "both":
          break;
      }

      console.warn("casdfasdf");

      progress.value = 0;
      progress.value = withTiming(1, { duration: 10000 });
    }, [keyframes.length]);

    // progress.value = withRepeat(
    //   withSequence(
    //     // Reset to 0, then play the animation
    //     // withTiming(0),
    //     ...timingFrames
    //     // withTiming(0, { duration: 0 })
    //   ),
    //   iterationCount
    // );

    $style.push(
      useAnimatedStyle(() => {
        function interpolateWithUnits(
          progress: number,
          from: unknown = 0,
          to: unknown = 0
        ) {
          if (typeof from === "number" && typeof to === "number") {
            return interpolate(progress, [0, 1], [from, to]);
          } else if (
            (typeof from === "string" && typeof to === "string") ||
            (typeof from === "string" && to === 0)
          ) {
            const unit = from.match(/[a-z%]+$/)?.[0];

            if (unit) {
              return `${interpolate(
                progress,
                [0, 1],
                [Number.parseFloat(from), Number.parseFloat(to.toString())]
              )}${unit}`;
            }
          } else if (typeof to === "string" && from === 0) {
            const unit = to.match(/[a-z%]+$/)?.[0];

            if (unit) {
              return `${interpolate(
                progress,
                [0, 1],
                [from, Number.parseFloat(to)]
              )}${unit}`;
            }
          }

          return 0;
        }

        const frameProgress = progress.value % 1;

        // console.warn(progress.value.toFixed(2), frameProgress.toFixed(2));

        // The initial frame needs no interpolation
        if (progress.value === 0) {
          return keyframes[0].style;
        }

        // Same with the last
        if (progress.value === keyframes.length - 1) {
          return keyframes[keyframes.length - 1].style;
        }

        const from = Math.floor(progress.value);
        const fromStyles = keyframes[from].style;
        const to = Math.ceil(progress.value);
        const toStyles = keyframes[to].style;

        const style: Record<string, unknown> = {};

        for (const entry of Object.entries(toStyles)) {
          const key = entry[0] as keyof Style;
          const toValue = entry[1];

          let fromValue = fromStyles[key];

          // If the current key is not in the from styles, try to find it in the previous styles
          if (fromValue === undefined) {
            for (let index = from; index >= 0; index--) {
              if (fromStyles[key]) {
                fromValue = fromStyles[key];
                break;
              }
            }
          }

          if (key === "transform") {
            let fromTransform = Object.assign(
              {},
              ...((fromValue as unknown as Record<string, unknown>[]) ?? [])
            );

            let toTransform = Object.assign(
              {},
              ...(toValue as Record<string, unknown>[])
            );

            const transformKeys = Array.from(
              new Set([
                ...Object.keys(fromTransform),
                ...Object.keys(toTransform),
              ])
            );

            const styleTransform =
              (style.transform as unknown[] | undefined) ?? [];

            fromTransform = Object.assign(
              {},
              defaultTransform,
              ...styleTransform,
              fromTransform
            );

            toTransform = Object.assign({}, defaultTransform, toTransform);

            style[key] = transformKeys.map((k) => {
              return {
                [k]: interpolateWithUnits(
                  frameProgress,
                  fromTransform[k],
                  toTransform[k]
                ),
              };
            });
          } else {
            style[key] = interpolateWithUnits(
              frameProgress,
              fromValue,
              toValue
            );
          }
        }

        return style;
      }, [progress])
    );
  }
  /* eslint-enable react-hooks/rules-of-hooks */

  return $style;
}

function useTransitions(style: Style): StyleProp {
  const {
    duration: durations = [{ type: "milliseconds", value: 0 }],
    property: properties = [],
  } = styleMetaMap.get(style)?.transition ?? {};

  const numOfProperties = properties.length;
  const animatedTyped = useState(() =>
    properties.map((p) => {
      let type: string | undefined;
      if (numericTransitions.has(p)) {
        type = "numeric";
      } else if (colorTransitions.has(p)) {
        type = "color";
      }

      return [p, type] as const;
    })
  )[0];

  if (__DEV__) {
    if (numOfProperties !== animatedTyped.length) {
      throw new Error(
        "Number of transition properties must match between renders"
      );
    }
  }

  const progresses: any[] = [];
  const outputs: any[] = [];

  /* eslint-disable react-hooks/rules-of-hooks */
  for (let index = 0; index < numOfProperties; index++) {
    const prop = properties[index];
    const value = style[prop as keyof Style];

    const output = useSharedValue<[unknown, unknown] | undefined>(undefined);
    const progress = useSharedValue(0);

    progresses.push(progress);
    outputs.push(output);

    const duration = getValue(durations, index, {
      type: "milliseconds",
      value: 0,
    }).value;

    if (output.value === undefined) {
      if (value !== undefined) {
        output.value = [value, value];
      }
    } else {
      output.value = [output.value[1], value];
      progress.value = 0;
      progress.value = withTiming(1, { duration });
    }
  }
  /* eslint-enable react-hooks/rules-of-hooks */

  return useAnimatedStyle(() => {
    const style: Record<string, unknown> = {};
    for (let index = 0; index < numOfProperties; index++) {
      const [prop, type] = animatedTyped[index];
      const progress = progresses[index];
      const output = outputs[index];

      if (!output.value) {
        continue;
      }

      if (type === "color") {
        style[prop] = interpolateColor(progress.value, [0, 1], output.value);
      } else if (type === "numeric") {
        style[prop] = interpolate(progress.value, [0, 1], output.value);
      }
    }
    return style;
  }, [...outputs, ...progresses]);
}

function getValue<T>(array: T[] | undefined, index: number, defaultValue: T) {
  return array ? array[index % array.length] : defaultValue;
}

function timeToMS(time: Time) {
  return time.type === "milliseconds" ? time.value : time.value * 1000;
}

function countToInteger(count: AnimationIterationCount) {
  return count.type === "infinite" ? Infinity : count.value;
}

const defaultTransform = {
  perspective: 0,
  translateX: 0,
  translateY: 0,
  scaleX: 0,
  scaleY: 0,
  rotate: 0,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  skewX: 0,
  skewY: 0,
  scale: 0,
};

function timingToEasing(timingFunction: EasingFunction) {
  switch (timingFunction.type) {
    case "linear":
    case "ease":
    case "ease-in":
    case "ease-out":
    case "ease-in-out":
      return Easing.linear;
    case "cubic-bezier":
      return Easing.linear;
    // return Easing.bezier(
    //   timingFunction.x1,
    //   timingFunction.y1,
    //   timingFunction.x2,
    //   timingFunction.y2
    // );
    case "steps":
      throw new Error("Not supported");
    default:
      exhaustiveCheck(timingFunction);
      throw new Error("Unknown timing function");
  }
}

const numericTransitions = new Set([
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRadius",
  "borderRightWidth",
  "borderTopWidth",
  "borderWidth",
  "bottom",
  "flex",
  "flexBasis",
  "flexGrow",
  "flexShrink",
  "fontSize",
  "fontWeight",
  "gap",
  "height",
  "left",
  "letterSpacing",
  "lineHeight",
  "margin",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginTop",
  "maxHeight",
  "maxWidth",
  "minHeight",
  "minWidth",
  "objectPosition",
  "opacity",
  "padding",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "right",
  "textDecoration",
  "top",
  "transformOrigin",
  "verticalAlign",
  "visibility",
  "width",
  "wordSpacing",
  "zIndex",
]);

const colorTransitions = new Set([
  "backgroundColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderRightColor",
  "borderTopColor",
  "color",
]);
