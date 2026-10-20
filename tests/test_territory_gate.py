"""Territory lock gate. All rows are synthetic."""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/territory-lock/scripts"))
import territory_gate as g

CA = g.load_territory("emcor")
TE = g.load_territory("techevo")
US = g.load_territory("some-new-client")


def d(row, t=CA):
    return g.gate_row(row, t)[0]


class CompanyLevel(unittest.TestCase):
    def test_maps_listing_out_of_state_from_ca_seed(self):
        # The CT case: Maps state CT / ZIP 06514 under a CA-seeded search.
        self.assertEqual(d({"maps_state": "CT", "maps_zip": "06514", "title": "Owner"}), "drop")
        self.assertEqual(d({"maps_zip": "06514"}), "drop")

    def test_maps_wins_over_hq(self):
        # National chain: HQ elsewhere, real CA listing -> pass.
        self.assertEqual(d({"maps_state": "CA", "maps_zip": "95814", "company_state": "TX"}), "pass")

    def test_hq_location_text(self):
        self.assertEqual(d({"company_location": "Hartford, Connecticut, United States"}), "drop")
        self.assertEqual(d({"company_location": "Sacramento, CA 95814"}), "pass")

    def test_non_us(self):
        self.assertEqual(d({"company_country": "Canada"}, US), "drop")
        self.assertEqual(d({"company_location": "Toronto, Ontario, Canada"}, US), "drop")
        self.assertEqual(d({"company_state": "TX", "company_country": "United States"}, US), "pass")


class PersonLevel(unittest.TestCase):
    def test_title_region_list(self):
        r = {"maps_state": "CA", "maps_zip": "96001", "title": "VP of Operations - CT/ME/NH"}
        self.assertEqual(d(r), "drop")
        self.assertIn("CT/ME/NH", g.gate_row(r, CA)[1])

    def test_title_regions(self):
        base = {"maps_state": "CA", "maps_zip": "96001"}
        for t in ["Northeast Regional Manager", "Director, Midwest", "Facilities Manager (New England)",
                  "Director of Connecticut Operations", "Area Manager, NY, NJ & PA"]:
            self.assertEqual(d({**base, "title": t}), "drop", t)

    def test_title_false_positives_kept(self):
        base = {"maps_state": "CA", "maps_zip": "96001"}
        for t in ["Director of IT", "Call Me Maybe Coordinator", "Medical Director", "Chief Operating Officer",
                  "Facilities Manager - Maintenance", "VP, Sales & Marketing", "Operations Manager - West Coast",
                  "Regional Manager - CA/NV", "Ops Lead, CA", "Plant Manager", "Director of Operations - Northern California"]:
            self.assertEqual(d({**base, "title": t}), "pass", t)

    def test_oregon_code_is_out_for_ca(self):
        self.assertEqual(d({"maps_state": "CA", "maps_zip": "96001", "title": "Ops Lead, OR"}), "drop")

    def test_lowercase_codes_not_states(self):
        self.assertEqual(g.title_places("Manager - Ct")[0], set())
        self.assertEqual(g.title_places("Me and Ops")[0], set())

    def test_person_location(self):
        base = {"maps_state": "CA", "maps_zip": "96001"}
        self.assertEqual(d({**base, "person_location": "New Haven, Connecticut, United States"}), "drop")
        self.assertEqual(d({**base, "person_location": "Redding, California, United States"}), "pass")
        self.assertEqual(d({**base, "person_location": "London, England, United Kingdom"}), "drop")


class Hold(unittest.TestCase):
    def test_no_location_held(self):
        self.assertEqual(d({"title": "Facilities Director"}), "hold")
        self.assertEqual(d({}, US), "hold")

    def test_person_only_location_in_territory_passes(self):
        self.assertEqual(d({"person_location": "Fresno, California, United States"}), "pass")


class TechEvo(unittest.TestCase):
    def test_new_england_and_south_florida(self):
        self.assertEqual(d({"company_state": "MA", "company_zip": "02110"}, TE), "pass")
        self.assertEqual(d({"company_state": "FL", "company_zip": "33131"}, TE), "pass")
        self.assertEqual(d({"company_state": "FL", "company_zip": "33401"}, TE), "pass")

    def test_tampa_and_nyc_excluded(self):
        self.assertEqual(d({"company_state": "FL", "company_zip": "33602"}, TE), "drop")
        self.assertEqual(d({"company_state": "FL", "company_city": "Tampa"}, TE), "drop")
        self.assertEqual(d({"company_state": "NY", "company_zip": "10001"}, TE), "drop")
        self.assertEqual(d({"company_state": "FL", "company_zip": "32801"}, TE), "drop")  # Orlando

    def test_florida_without_zip_held(self):
        self.assertEqual(d({"company_state": "FL"}, TE), "hold")

    def test_new_england_title_ok_for_techevo(self):
        r = {"company_state": "CT", "company_zip": "06510", "title": "VP of Operations - CT/ME/NH"}
        self.assertEqual(d(r, TE), "pass")


class Receipt(unittest.TestCase):
    def test_receipt_counts_and_reasons(self):
        rows = [{"maps_zip": "96001"}, {"maps_zip": "06514"}, {}]
        out, rc = g.run(rows, CA)
        s = rc["territory_lock"]
        self.assertEqual((s["passed"], s["dropped"], s["held_no_location"]), (1, 1, 1))
        self.assertEqual(len(s["log"]), 2)
        self.assertTrue(all(e["reason"] for e in s["log"]))


if __name__ == "__main__":
    unittest.main()
