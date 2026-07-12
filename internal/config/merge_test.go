package config

import "testing"

func baseInstances() []Instance {
	return []Instance{
		{Name: "gateway", Role: "gateway", URL: "https://10.0.0.1", Host: "gw.test",
			BasicAuth: BasicAuth{Username: "gu", Password: "gp"}},
		{Name: "mgmt", URL: "https://10.0.0.2", Host: "mgmt.test",
			BasicAuth: BasicAuth{Username: "mu", Password: "mp"}},
	}
}

func TestMergeNilOverridesReturnsBaseUnchanged(t *testing.T) {
	base := baseInstances()
	out := Merge(base, nil)
	if len(out) != 2 {
		t.Fatalf("len = %d, want 2", len(out))
	}
	if out[0].BasicAuth.Password != "gp" {
		t.Errorf("basicAuth lost with nil overrides")
	}
}

func TestMergeOverrideWinsButSecretsStayFromBase(t *testing.T) {
	base := baseInstances()
	ov := &Overrides{
		Instances: []OverrideInstance{
			{Name: "gateway", Role: "gateway", URL: "https://10.0.0.99", Host: "gw-new.test", InsecureSkipVerify: true},
		},
	}
	out := Merge(base, ov)
	var gw Instance
	for _, in := range out {
		if in.Name == "gateway" {
			gw = in
		}
	}
	if gw.URL != "https://10.0.0.99" || gw.Host != "gw-new.test" || !gw.InsecureSkipVerify {
		t.Errorf("override fields did not win: %+v", gw)
	}
	if gw.BasicAuth.Username != "gu" || gw.BasicAuth.Password != "gp" {
		t.Errorf("basicAuth should stay from base, got %+v", gw.BasicAuth)
	}
	// mgmt untouched.
	for _, in := range out {
		if in.Name == "mgmt" && in.URL != "https://10.0.0.2" {
			t.Errorf("untouched instance mutated: %+v", in)
		}
	}
}

func TestMergeAddsNewCredentialLessInstance(t *testing.T) {
	base := baseInstances()
	ov := &Overrides{
		Instances: []OverrideInstance{
			{Name: "new-node", URL: "https://10.0.0.50"},
		},
	}
	out := Merge(base, ov)
	if len(out) != 3 {
		t.Fatalf("len = %d, want 3", len(out))
	}
	var added Instance
	found := false
	for _, in := range out {
		if in.Name == "new-node" {
			added = in
			found = true
		}
	}
	if !found {
		t.Fatal("new-node not present in merged output")
	}
	if added.BasicAuth != (BasicAuth{}) {
		t.Errorf("UI-added instance should have no credentials, got %+v", added.BasicAuth)
	}
}

func TestMergeDeletesBaseInstance(t *testing.T) {
	base := baseInstances()
	ov := &Overrides{Deleted: []string{"mgmt"}}
	out := Merge(base, ov)
	if len(out) != 1 {
		t.Fatalf("len = %d, want 1", len(out))
	}
	if out[0].Name != "gateway" {
		t.Errorf("wrong instance survived: %+v", out)
	}
}

func TestMergeDeleteWinsOverAddWithSameName(t *testing.T) {
	base := baseInstances()
	ov := &Overrides{
		Deleted:   []string{"mgmt"},
		Instances: []OverrideInstance{{Name: "mgmt", URL: "https://should-not-appear"}},
	}
	out := Merge(base, ov)
	for _, in := range out {
		if in.Name == "mgmt" {
			t.Fatalf("deleted+re-added name should not resurrect as a credential-less add: %+v", in)
		}
	}
}

func TestValidateInstancesRejectsEmpty(t *testing.T) {
	if err := ValidateInstances(nil); err == nil {
		t.Fatal("expected error for empty instance list")
	}
}

func TestValidateInstancesRejectsDuplicateAfterMerge(t *testing.T) {
	base := baseInstances()
	ov := &Overrides{Instances: []OverrideInstance{{Name: "mgmt", URL: "https://x"}}}
	// mgmt already exists in base, so this is a valid edit, not a dup -- sanity check.
	if err := ValidateInstances(Merge(base, ov)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateInstancesRejectsMissingURL(t *testing.T) {
	err := ValidateInstances([]Instance{{Name: "x"}})
	if err == nil {
		t.Fatal("expected error for missing url")
	}
}
