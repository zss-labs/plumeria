/**
 * Type definitions. Without runtime implementation.
 * Bundler plugin required.
 * ```ts
 * type styled = { [T in keyof JSX.IntrinsicElements]: <const R>(rule: R) => StyledComponent<T, R> };
 * ```
 */
import type {
  ComponentPropsWithRef,
  JSX,
  JSXElementConstructor,
  ReactElement,
} from 'react';
import type {
  AtomicClassNameFor,
  AtomicStyle,
  CSSProperties,
  Style,
} from '@plumeria/core';

type NestedKey = `:${string}` | `[${string}` | `@${string}`;

type Dynamic<T, P> = {
  [K in keyof T]: K extends NestedKey
    ? Dynamic<T[K], P>
    : T[K] | ((props: P) => T[K]);
};

export type StyledRule<P> = Dynamic<CSSProperties, P>;

type Reads<R> =
  R extends AtomicClassNameFor<string, infer V>
    ? Reads<V>
    : R extends (props: infer A) => any
      ? 0 extends 1 & A
        ? Record<string, any>
        : A
      : R extends object
        ? { [K in keyof R]: Reads<R[K]> }[keyof R]
        : never;

type Intersect<U> = (U extends any ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;

export type StyledPropsOf<R> = [Reads<R>] extends [never]
  ? {}
  : Intersect<Reads<R>>;

export interface JSXRegister {}

type Framework = JSXRegister extends {
  IntrinsicElements: infer I;
  Element: infer E;
}
  ? { intrinsic: I; element: E; useReactProps: false }
  : {
      intrinsic: JSX.IntrinsicElements;
      element: ReactElement;
      useReactProps: true;
    };

type Intrinsic = Framework['intrinsic'];

export type StyledTarget =
  | keyof Intrinsic
  | (Framework['useReactProps'] extends true
      ? JSXElementConstructor<any>
      : (props: any) => any);

type PropsOf<T> = Framework['useReactProps'] extends true
  ? T extends keyof JSX.IntrinsicElements | JSXElementConstructor<any>
    ? ComponentPropsWithRef<T>
    : never
  : T extends keyof Intrinsic
    ? Intrinsic[T]
    : T extends (props: infer P) => any
      ? P
      : never;

type Known<T> = {
  [K in keyof T as string extends K ? never : K]: T[K];
};

export type StyledProps<T extends StyledTarget, P> = P &
  Omit<
    Framework['useReactProps'] extends true ? PropsOf<T> : Known<PropsOf<T>>,
    keyof Known<P> | 'sx'
  > & {
    sx?: Style;
  };

declare const styledBrand: unique symbol;

type Branded = { readonly [styledBrand]: unknown };

export type StyledComponent<T extends StyledTarget, R> = ((
  props: StyledProps<T, StyledPropsOf<R>>,
) => Framework['element']) & {
  readonly [styledBrand]: R;
};

export type StyledFactory<T extends StyledTarget> = {
  <const R extends StyledRule<any>>(
    rule: R,
  ): StyledComponent<T, AtomicStyle<R>>;
  new (rule: never): never;
};

export type styled = {
  <C extends ((props: any) => any) & Branded>(component: C): StyledFactory<C>;
} & {
  [T in keyof Intrinsic]: StyledFactory<T>;
};

export const styled: styled;
