/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

//
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// spans.js: JavaScript Intset/Location port.
//

"use strict";

export class Range {
	constructor(min, max, isContiguous = true) {
		// FIX ME: Bad idea to type check in a dynamic language
		if (typeof(min) != 'number' || typeof(max) != 'number')
			throw Error('Bad range ' + min + ',' + max);

		this._min = min;
		this._max = max;
		this.isContiguous = isContiguous;
	}

	_pushRanges(ranges) {
		ranges.push(this);
	}

	min() {
		return this._min;
	}

	max() {
		return this._max;
	}

	contains(pos) {
		return pos >= this._min && pos <= this._max;
	}

	isContiguous() {
		return this.isContiguous;
	}

	ranges() {
		return [this];
	}

	toString() {
		return `[${this._min} - ${this._max}]`;
	}
}


class _Compound {
	constructor(ranges) {
		const sorted = ranges.sort(rangerOrder);
		// merge overlaps between adjacent ranges
		let merged = [];
		let current = sorted.shift();

		sorted.forEach(function(range) {
			if (range._min <= current._max) {
				if (range._max > current._max) {
					current._max = range._max;
				}
			} else {
				merged.push(current);
				current = range;
			}
		});
		merged.push(current);
		this.ranges = merged;
	}
	min() {
		return this.ranges[0].min();
	}

	max() {
		return this.ranges[this.ranges.length - 1].max();
	}

	lower_bound(pos) {
		// first check if pos is out of range
		let r = this.ranges();

		if (pos > this.max()) {
			return r.length;
		}

		if (pos < this.min()) {
			return 0;
		}

		// do a binary search
		let a = 0;
		let b = r.length - 1;

		while (a <= b) {
			let m = Math.floor((a + b) / 2);

			if (pos > r[m]._max) {
				a = m + 1;
			} else if (pos < r[m]._min) {
				b = m - 1;
			} else {
				return m;
			}
		}

		return a;
	}

	contains(pos) {
		let lb = this.lower_bound(pos);

		if (lb < this.ranges.length && this.ranges[lb].contains(pos)) {
			return true;
		}

		return false;
	}

	insertRange(range) {
		// FIXME: Correct modifying argument
		const lb = this.lower_bound(range._min);

		if (lb === this.ranges.length) { // range follows this
			this.ranges.push(range);

			return;
		}

		let r = this.ranges();

		if (range._max < r[lb]._min) { // range preceeds lb
			this.ranges.splice(lb, 0, range);

			return;
		}

		// range overlaps lb (at least)
		if (r[lb]._min < range._min) {
			range._min = r[lb]._min;
		}

		let ub = lb + 1;

		while (ub < r.length && r[ub]._min <= range._max) {
			ub++;
		}

		ub--;

		// ub is the upper bound of the new range
		if (r[ub]._max > range._max) {
			range._max = r[ub]._max;
		}

		// splice range into this.ranges
		this.ranges.splice(lb, ub - lb + 1, range);

		return;
	}

	isContiguous() {
		return this.ranges.length > 1;
	}

	ranges() {
		return this.ranges;
	}

	_pushRanges(ranges) {
		for (let ri = 0; ri < this.ranges.length; ++ri) {
			ranges.push(this.ranges[ri]);
		}
	}

	toString() {
		let s = '';

		for (let r = 0; r < this.ranges.length; ++r) {
			// FIXME: Use .join and then .toString rather than concentenate
			if (r > 0) {
				s = s + ',';
			}
			s = s + this.ranges[r].toString();
		}
		return s;
	}
}


export const union = (s0, s1) => {
	if (!(s0 instanceof _Compound)) {
		if (!(s0 instanceof Array))
			s0 = [s0];
		s0 = new _Compound(s0);
	}

	if (s1)
		s0.insertRange(s1);

	return s0;
}

export const intersection = (s0, s1) => {
	let r0 = s0.ranges();
	let r1 = s1.ranges();
	let l0 = r0.length;
	let	l1 = r1.length;

	let i0 = 0;
	let	i1 = 0;
	let or = [];

	while (i0 < l0 && i1 < l1) {
		let s0 = r0[i0];
		let	s1 = r1[i1];
		let lapMin = Math.max(s0.min(), s1.min());
		let lapMax = Math.min(s0.max(), s1.max());

        if (lapMax >= lapMin) {
			or.push(new Range(lapMin, lapMax));
		}

        if (s0.max() > s1.max()) {
			++i1;
		} else {
			++i0;
		}
	}

	if (or.length == 0) {
		return null; // FIXME- Original developer did not explain why
	} else if (or.length === 1) {
		return or[0];
	} else {
		return new _Compound(or);
	}
}

export const coverage = s =>  {
	let tot = 0;
	let rl = s.ranges();

	for (let ri = 0; ri < rl.length; ++ri) {
		let r = rl[ri];
		tot += (r.max() - r.min() + 1);
	}

	return tot;
}

export const rangeOver = (a, b) => {
	if (a.min() < b.min()) {
		return -1;
	} else if (a.min() > b.min()) {
		return 1;
	} else if (a.max() < b.max()) {
		return -1;
	} else if (b.max() > a.max()) {
		return 1;
	} else {
		return 0;
	}
}

export const rangerOrder = (a, b) => {
	if (a._min < b._min) {
		return -1;
	} else if (a._min > b._min) {
		return 1;
	} else if (a._max < b._max) {
		return -1;
	} else if (b._max > a._max) {
		return 1;
	} else {
		return 0;
	}
}
