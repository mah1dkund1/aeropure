package com.aeropure.aeropure_backend.service;

import com.aeropure.aeropure_backend.model.Reading;
import com.aeropure.aeropure_backend.repository.ReadingRepository;
import org.springframework.stereotype.Service;


import java.time.LocalDateTime;
import java.util.List;



@Service

public class ReadingService {

    private final ReadingRepository readingRepository;

    public ReadingService(ReadingRepository readingRepository) {
        this.readingRepository = readingRepository;

    }

    public Reading saveReading(Reading reading) {
        reading.setReceivedAt(LocalDateTime.now());
        return readingRepository.save(reading);
    }


    // get methods

    public List<Reading> getReadings(Integer deviceId, int limit) {
        List<Reading> all = (deviceId != null)
                ? readingRepository.findByDeviceIdOrderByReceivedAtDesc(deviceId)
                : readingRepository.findAllByOrderByReceivedAtDesc();

        return all.size() > limit ? all.subList(0, limit) : all;

    }

    public long countReadings(Integer deviceId) {
        List<Reading> all = (deviceId != null)
                ? readingRepository.findByDeviceIdOrderByReceivedAtDesc(deviceId)
                : readingRepository.findAllByOrderByReceivedAtDesc();
        return all.size();

    }

// post data/range , the one below is basically a get method but user input is needed

    public List<Reading> getReadingsInRange(Integer deviceId, LocalDateTime start, LocalDateTime end) {
        return readingRepository.findByDeviceIdAndReceivedAtBetweenOrderByReceivedAtDesc(deviceId, start, end);

    }

    // get devices

    public List<Integer> getDistinctDeviceIds() {
        return readingRepository.findDistinctDeviceIds();

    }

    public void deleteReadingsByDeviceId(Integer deviceId) {

readingRepository.deleteByDeviceId(deviceId);
    }

}
