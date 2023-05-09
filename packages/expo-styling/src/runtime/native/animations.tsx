import React, { ComponentType, forwardRef, useMemo } from "react";
import {
  SharedValue,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  ContainerRuntime,
  ExtractedAnimation,
  Interaction,
  InteropMeta,
  Style,
} from "../../types";
import { createAnimatedComponent } from "./animated-component";
import { FlattenStyleOptions, flattenStyle } from "./flattenStyle";
import { animationMap, styleMetaMap } from "./globals";

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
    const style = props[prop] as Style;
    const { schema, dependencies } = useSchema(style, {
      variables: __variables,
      interaction: __interaction,
      containers: __containers,
      ch: typeof style.height === "number" ? style.height : undefined,
      cw: typeof style.width === "number" ? style.width : undefined,
    });

    props[prop] = useAnimated(schema, dependencies, style);
  }
  /* eslint-enable react-hooks/rules-of-hooks */

  return <Component ref={ref} {...props} />;
});

type Schema = {
  animations: AnimationSchema[];
  transitions: TransitionSchema[];
};

type AnimationSchema = {
  frames: any[];
};

type TransitionSchema = {
  output: [any, any];
  prop: keyof Style;
};

function useSchema(style: Style, options: FlattenStyleOptions) {
  const schema = useSharedValue<Schema>({ animations: [], transitions: [] });

  const animationsSchemas: AnimationSchema[] = [];
  const transitionSchemas: TransitionSchema[] = [];

  const dependencies: Record<string, SharedValue<number>[]> = {
    animations: [],
    transitions: [],
  };

  const { animations = {}, transition = {} } = styleMetaMap.get(style) || {};
  const { name: animationNames = [] } = animations;
  const { property: transitions = [] } = transition;

  let updated = false;

  /* eslint-disable react-hooks/rules-of-hooks */
  for (let index = 0; index < animationNames.length; index++) {
    const name = getValue(animationNames, index, { type: "none" });

    const progress = useSharedValue(0);

    dependencies.animations.push(progress);

    let keyframes: ExtractedAnimation;
    if (name.type === "none") {
      keyframes = defaultAnimation;
    } else {
      keyframes = animationMap.get(name.value) || defaultAnimation;
    }

    const frames = useMemo(() => {
      progress.value = 0;
      progress.value = withTiming(1, { duration: 10000 });
      updated = true;

      return keyframes.frames.map((frame) => ({
        ...frame,
        style: flattenStyle(frame.style, options),
      }));
    }, [keyframes]);

    animationsSchemas.push({ frames });
  }
  /* eslint-enable react-hooks/rules-of-hooks */

  /* eslint-disable react-hooks/rules-of-hooks */
  for (let index = 0; index < transitions.length; index++) {
    const prop = transitions[index];
    const value = style[prop];

    const progress = useSharedValue(0);
    dependencies.transitions.push(progress);

    const previous = schema.value.transitions[index]?.output;

    if (previous === undefined) {
      if (value !== undefined && value !== null) {
        updated = true;
        transitionSchemas.push({ prop, output: [value, value] });
      }
    } else {
      updated = true;
      transitionSchemas.push({ prop, output: [previous[1], value] });
      progress.value = 0;
      progress.value = withTiming(1, { duration: 1000 });
    }
  }
  /* eslint-enable react-hooks/rules-of-hooks */

  if (updated) {
    schema.value = {
      animations: animationsSchemas,
      transitions: transitionSchemas,
    };
  }

  return { schema, dependencies };
}

function useAnimated(
  schema: SharedValue<Schema>,
  dependencies: Record<string, SharedValue<number>[]>,
  style: Style
) {
  return Object.assign(
    {},
    style,
    useAnimatedStyle(() => {
      const result: Record<string, unknown> = { ...style };

      // Reanimated crashes if the fontWeight is numeric, so force cast to a string
      result.fontWeight = result.fontWeight?.toString();

      const { animations, transitions } = schema.value;

      for (let index = 0; index < dependencies.transitions.length; index++) {
        const { prop, output } = transitions[index] || {};
        const progress = dependencies.transitions[index].value;

        if (!output) continue;

        result[prop] = interpolation(progress, ...output, isColorProp(prop));
      }

      for (let index = 0; index < dependencies.animations.length; index++) {
        const { frames = [{ style: {} }] } = animations[index] || {};

        const progress = dependencies.animations[index].value;
        const frameProgress = progress % 1;

        if (progress === 0) {
          return frames[0].style;
        }

        if (progress === frames.length - 1) {
          return frames[frames.length - 1].style;
        }

        const from = Math.floor(progress);
        const fromStyles = frames[from]?.style;
        const to = Math.ceil(progress);
        const toStyles = frames[to]?.style;

        if (!fromStyles || !toStyles) {
          continue;
        }

        for (const [key, toValue] of Object.entries(toStyles)) {
          const fromValue = fromStyles[key];

          const fromTransform = Object.assign(
            {},
            defaultTransform,
            ...(style.transform ?? []),
            fromValue
          );

          const toTransform: Record<string, unknown> = Object.assign(
            {},
            ...(toValue as any[])
          );

          const transformKeys: string[] = Object.keys(toTransform);

          result.transform = transformKeys.map((k) => {
            return {
              [k]: interpolation(
                frameProgress,
                fromTransform[k],
                toTransform[k],
                isColorProp(k)
              ),
            };
          }) as unknown as Style["transform"];
        }
      }

      return result;
    }, [schema, style, ...dependencies.animations, ...dependencies.transitions])
  );
}

function isColorProp(prop: string) {
  "worklet";
  return (
    prop === "backgroundColor" ||
    prop === "borderBottomColor" ||
    prop === "borderLeftColor" ||
    prop === "borderRightColor" ||
    prop === "borderTopColor" ||
    prop === "color"
  );
}

function interpolation(progress: number, from: any, to: any, isColor: boolean) {
  "worklet";
  if (isColor) {
    return interpolateColor(progress, [0, 1], [from, to]);
  } else if (typeof from === "number" && typeof to === "number") {
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

function getValue<T>(array: T[] | undefined, index: number, defaultValue: T) {
  return array ? array[index % array.length] : defaultValue;
}

const defaultAnimation: ExtractedAnimation = { frames: [] };
const defaultTransform = {
  perspective: 0,
  translateX: 0,
  translateY: 0,
  scaleX: 0,
  scaleY: 0,
  rotate: 0,
  rotateX: "0deg",
  rotateY: "0deg",
  rotateZ: "0deg",
  skewX: 0,
  skewY: 0,
  scale: 0,
} as const;
