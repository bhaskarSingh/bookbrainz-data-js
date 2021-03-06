/*
 * Copyright (C) 2018  Ben Ockmore
 *           (C) 2018  Shivam Tripathi
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 */

// @flow

import type {
	FormAliasT as Alias,
	FormAliasWithDefaultT as AliasWithDefault,
	EntityTypeString,
	Transaction
} from './types';
import {
	createNewSetWithItems,
	getAddedItems,
	getRemovedItems,
	getUnchangedItems
} from './set';

import _ from 'lodash';
import {snakeToCamel} from '../util';


export async function updateAliasSet(
	orm: any, transacting: Transaction, oldSet: any, oldDefaultAliasId: ?number,
	newSetItemsWithDefault: Array<AliasWithDefault>
) {
	function comparisonFunc(obj: Alias, other: Alias) {
		return (
			obj.name === other.name &&
			obj.sortName === other.sortName &&
			obj.languageId === other.languageId &&
			obj.primary === other.primary
		);
	}

	const {AliasSet} = orm;

	const newSetItems: Array<Alias> =
		newSetItemsWithDefault.map((item) => _.omit(item, 'default'));

	const oldSetItems: Array<Alias> =
		oldSet ? oldSet.related('aliases').toJSON() : [];

	if (_.isEmpty(oldSetItems) && _.isEmpty(newSetItems)) {
		return oldSet || null;
	}

	const addedItems =
		getAddedItems(oldSetItems, newSetItems, comparisonFunc);
	const removedItems =
		getRemovedItems(oldSetItems, newSetItems, comparisonFunc);
	const unchangedItems =
		getUnchangedItems(oldSetItems, newSetItems, comparisonFunc);

	const newDefaultAlias = _.find(newSetItemsWithDefault, 'default');

	if (newDefaultAlias === undefined) {
		throw new Error('Default alias must be defined within alias set');
	}

	const isSetUnmodified = newDefaultAlias.id === oldDefaultAliasId &&
		_.isEmpty(addedItems) &&
		_.isEmpty(removedItems);

	if (isSetUnmodified) {
		// No action - set has not changed
		return oldSet;
	}

	const newSet = await createNewSetWithItems(
		orm, transacting, AliasSet, unchangedItems, addedItems, 'aliases'
	);

	const newSetItemCollection =
		await newSet.related('aliases').fetch({transacting});

	const defaultAlias = newSetItemCollection.find(
		(alias) =>
			alias.get('name') === newDefaultAlias.name &&
			alias.get('sortName') === newDefaultAlias.sortName &&
			alias.get('languageId') === newDefaultAlias.languageId
	);

	newSet.set('defaultAliasId', defaultAlias.get('id'));

	return newSet.save(null, {transacting});
}

export async function getAliasByIds(
	transacting: Transaction, ids: Array<number>
): Promise<Object> {
	try {
		const aliases = await transacting.select('*')
			.from('bookbrainz.alias')
			.whereIn('id', ids);
		return aliases.reduce((aliasesMap, alias) =>
			_.assign(aliasesMap, {[alias.id]: snakeToCamel(alias)}), {});
	}
	catch (error) {
		throw error;
	}
}

export function getAliasIds(
	transacting: Transaction, name: string, caseSensitive: boolean = false
): Promise<Array<Object>> {
	const trimmedName = _.trim(name);
	if (caseSensitive) {
		return transacting.select('id')
			.from('bookbrainz.alias')
			.where('name', trimmedName);
	}
	return transacting.select('id').from('bookbrainz.alias').where(
		transacting.raw('LOWER(TRIM("name")) = ?', trimmedName.toLowerCase())
	);
}

export async function getBBIDsWithMatchingAlias(
	transacting: Transaction,
	entityType: EntityTypeString,
	name: string,
	caseSensitive: boolean = false,
) {
	try {
		const aliasIds = _.map(
			await getAliasIds(transacting, name, caseSensitive),
			'id'
		);

		const aliasSetIds = _.map(
			await transacting.distinct('set_id')
				.select()
				.from('bookbrainz.alias_set__alias')
				.whereIn('alias_id', aliasIds),
			'set_id'
		);

		const bbids = _.map(
			await transacting.select('bbid')
				.from(`bookbrainz.${entityType}`)
				.whereIn('alias_set_id', aliasSetIds)
				.where('master', true),
			'bbid'
		);

		return bbids;
	}
	catch (error) {
		throw error;
	}
}

export async function doesAliasExist(
	transacting: Transaction,
	entityType: EntityTypeString,
	name: string,
	caseSensitive: boolean = false,
) {
	try {
		const bbids = await getBBIDsWithMatchingAlias(
			transacting, entityType, name, caseSensitive
		);
		return bbids.length > 0;
	}
	catch (error) {
		throw error;
	}
}
