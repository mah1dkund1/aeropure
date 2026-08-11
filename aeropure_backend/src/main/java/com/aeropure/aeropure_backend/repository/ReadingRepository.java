package com.aeropure.aeropure_backend.repository;

import com.aeropure.aeropure_backend.model.Reading;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDateTime;

import java.util.List;


public interface ReadingRepository extends JpaRepository <Reading,Long> {

    List<Reading> findByDeviceIdOrderByReceivedAtDesc(Integer deviceId);

    List<Reading> findAllByOrderByReceivedAtDesc();

    List<Reading> findByDeviceIdAndReceivedAtBetweenOrderByReceivedAtDesc(
            Integer deviceId, LocalDateTime start , LocalDateTime end );

    List<Reading> findByReceivedAtBetweenOrderByReceivedAtDesc(
            LocalDateTime start, LocalDateTime end);

    void deleteByDeviceId(Integer deviceId);

    @Query("SELECT DISTINCT r.deviceId FROM Reading r")
    List<Integer> findDistinctDeviceIds();



}
