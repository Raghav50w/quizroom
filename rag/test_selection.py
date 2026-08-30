"""Selection and ordering. No database, no model."""

from dataclasses import dataclass

from selection import even_sample, join, sort_by_ordinal


@dataclass(frozen=True)
class Row:
    ordinal: int
    text: str = ""


class TestEvenSample:
    def test_picks_four_spread_across_fifty_not_the_first_four(self):
        assert even_sample(list(range(50)), 4) == [6, 18, 31, 43]

    def test_reaches_the_last_quarter_of_a_long_document(self):
        # The bug this guards: `i * step` always picks index 0 and stops well
        # short of the end, so the tail of every document goes unsampled.
        picked = even_sample(list(range(100)), 4)
        assert picked[-1] > 75
        assert picked[0] > 0

    def test_returns_everything_when_there_are_fewer_than_asked_for(self):
        assert even_sample([0, 1, 2], 4) == [0, 1, 2]
        assert even_sample([], 4) == []

    def test_returns_everything_when_the_counts_match(self):
        assert even_sample([0, 1, 2, 3], 4) == [0, 1, 2, 3]

    def test_keeps_input_order_and_never_repeats(self):
        picked = even_sample(list(range(50)), 4)
        assert picked == sorted(picked)
        assert len(set(picked)) == len(picked)

    def test_does_not_mutate_the_input(self):
        items = list(range(10))
        even_sample(items, 4)
        assert items == list(range(10))

    def test_zero_or_negative_count(self):
        assert even_sample([1, 2, 3], 0) == []


class TestSortByOrdinal:
    def test_restores_document_order_from_similarity_order(self):
        # What cosine search actually hands back: most similar first.
        rows = [Row(31), Row(6), Row(43), Row(18)]
        assert [r.ordinal for r in sort_by_ordinal(rows)] == [6, 18, 31, 43]

    def test_does_not_mutate_the_input(self):
        rows = [Row(2), Row(0)]
        sort_by_ordinal(rows)
        assert [r.ordinal for r in rows] == [2, 0]

    def test_join_emits_document_order(self):
        rows = [Row(2, "third"), Row(0, "first"), Row(1, "second")]
        assert join(rows) == "first\n\nsecond\n\nthird"
