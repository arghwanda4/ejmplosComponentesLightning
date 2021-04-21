/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: MIT
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/MIT
 */
import { isArray, isUndefined, ArrayJoin, ArrayPush, isNull } from '@lwc/shared';

import * as api from './api';
import { VNode } from '../3rdparty/snabbdom/types';
import { VM } from './vm';
import { Template, TemplateStylesheetTokens } from './template';
import { getStyleOrSwappedStyle } from './hot-swaps';

/**
 * Function producing style based on a host and a shadow selector. This function is invoked by
 * the engine with different values depending on the mode that the component is running on.
 */
export type StylesheetFactory = (
    hostSelector: string,
    shadowSelector: string,
    nativeShadow: boolean
) => string;

/**
 * The list of stylesheets associated with a template. Each entry is either a StylesheetFactory or a
 * TemplateStylesheetFactory a given stylesheet depends on other external stylesheets (via the
 * @import CSS declaration).
 */
export type TemplateStylesheetFactories = Array<StylesheetFactory | TemplateStylesheetFactories>;

function createShadowStyleVNode(content: string): VNode {
    return api.h(
        'style',
        {
            key: 'style', // special key
            attrs: {
                type: 'text/css',
            },
        },
        [api.t(content)]
    );
}

export function updateSyntheticShadowAttributes(vm: VM, template: Template) {
    const { elm, context, renderer } = vm;
    const { stylesheets: newStylesheets, stylesheetTokens: newStylesheetTokens } = template;
    const isLightDom = isNull(vm.cmpRoot);

    let newTokens: TemplateStylesheetTokens | undefined;

    // Reset the styling token applied to the host element.
    const oldHostAttribute = context.hostAttribute;
    if (!isUndefined(oldHostAttribute)) {
        renderer.removeAttribute(elm, oldHostAttribute);
    }

    // Apply the new template styling token to the host element, if the new template has any
    // associated stylesheets.
    if (!isLightDom && !isUndefined(newStylesheets) && newStylesheets.length !== 0) {
        newTokens = newStylesheetTokens;
    }

    if (newTokens) {
        renderer.setAttribute(elm, newTokens.hostAttribute, '');
    }

    // Update the styling tokens present on the context object.
    context.hostAttribute = newTokens?.hostAttribute;
    context.shadowAttribute = newTokens?.shadowAttribute;
}

function evaluateStylesheetsContent(
    stylesheets: TemplateStylesheetFactories,
    hostSelector: string,
    shadowSelector: string,
    nativeShadow: boolean
): string[] {
    const content: string[] = [];

    for (let i = 0; i < stylesheets.length; i++) {
        let stylesheet = stylesheets[i];

        if (isArray(stylesheet)) {
            ArrayPush.apply(
                content,
                evaluateStylesheetsContent(stylesheet, hostSelector, shadowSelector, nativeShadow)
            );
        } else {
            if (process.env.NODE_ENV !== 'production') {
                // in dev-mode, we support hot swapping of stylesheet, which means that
                // the component instance might be attempting to use an old version of
                // the stylesheet, while internally, we have a replacement for it.
                stylesheet = getStyleOrSwappedStyle(stylesheet);
            }
            ArrayPush.call(content, stylesheet(hostSelector, shadowSelector, nativeShadow));
        }
    }

    return content;
}

export function getStylesheetsContent(vm: VM, template: Template): string[] {
    const { stylesheets, stylesheetTokens } = template;
    const { syntheticShadow } = vm.renderer;
    const isLightDom = isNull(vm.cmpRoot);

    let content: string[] = [];

    if (!isUndefined(stylesheets) && stylesheets.length !== 0) {
        const tokens = syntheticShadow && !isLightDom && stylesheetTokens;

        const hostSelector = tokens ? `[${tokens.hostAttribute}]` : '';
        const shadowSelector = tokens ? `[${tokens.shadowAttribute}]` : '';

        content = evaluateStylesheetsContent(
            stylesheets,
            hostSelector,
            shadowSelector,
            !syntheticShadow
        );
    }

    return content;
}

export function createStylesheet(vm: VM, stylesheets: string[]): VNode | null {
    const { renderer } = vm;
    const isLightDom = isNull(vm.cmpRoot);

    if (isLightDom) {
        const root = vm.elm.getRootNode();
        const host = root?.host;
        for (let i = 0; i < stylesheets.length; i++) {
            if (host) {
                renderer.insertStylesheet(root, stylesheets[i]);
            } else {
                // document-level
                renderer.insertGlobalStylesheet(stylesheets[i]);
            }
        }
        return null;
    } else if (renderer.syntheticShadow) {
        for (let i = 0; i < stylesheets.length; i++) {
            renderer.insertGlobalStylesheet(stylesheets[i]);
        }

        return null;
    } else {
        const shadowStyleSheetContent = ArrayJoin.call(stylesheets, '\n');
        return createShadowStyleVNode(shadowStyleSheetContent);
    }
}
