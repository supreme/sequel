package store

func (s *Store) Active(org string) error {
	rows, err := s.db.Query(`
		SELECT id, email
		FROM users -- active only
		WHERE org = $1 AND deleted_at IS NULL
	`, org)
	_, err = s.db.Exec("UPDATE users SET seen = now() WHERE id = $1", id)
	type T struct {
		Name string `json:"name"`
	}
	return err
}
