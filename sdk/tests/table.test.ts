import { describe, expect, test } from 'bun:test';
import { TableQueryBuilder } from '../src/table';

describe('direct table query builder', () => {
	test('emits joins, grouped aggregates, having, and near as native TSELECT args', async () => {
		let seen: string[] = [];
		const client = {
			call: async () => 'OK',
			_tselect: async (args: string[]) => {
				seen = args;
				return [];
			},
			_subscribePattern: async () => () => {},
		};

		await new TableQueryBuilder(client, 'members')
			.select('team_id,COUNT(*) AS count')
			.leftJoin('teams', 't', 'team_id', 'id')
			.group('team_id')
			.having('count', '>', 1)
			.near('embedding', [1, 0], { k: 5, threshold: 0.8 });

		expect(seen).toEqual([
			'team_id,COUNT(*) AS count',
			'FROM',
			'members',
			'LEFT',
			'JOIN',
			'teams',
			't',
			'ON',
			'team_id',
			'=',
			'id',
			'GROUP',
			'BY',
			'team_id',
			'HAVING',
			'count',
			'>',
			'1',
			'NEAR',
			'embedding',
			'[1,0]',
			'K',
			'5',
			'THRESHOLD',
			'0.8',
		]);
	});
});
